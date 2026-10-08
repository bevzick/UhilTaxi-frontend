<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import L from 'leaflet'
import { ApiError } from '@/api/http'
import { driverApi } from '@/api/orders'
import { useAuth } from '@/composables/useAuth'
import { useGeolocation } from '@/composables/useGeolocation'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { RouteLayer, createCityMap, icons, requestIcon } from '@/utils/map'
import { formatFare, formatKm, fullName, initials, isFinal, timeAgo } from '@/utils/order'
import type { OrderStage, OrderView, TripView } from '@/types/order'

const LIST_POLL_MS = 5000
const ACTIVE_POLL_MS = 4000
const ONLINE_KEY = 'uhiltaxi.driver-online'

const ACTIVE_TITLE: Record<OrderStage, string> = {
  searching: 'Замовлення',
  accepted: 'Їдьте до клієнта',
  arrived: 'Очікуєте клієнта',
  started: 'Везете клієнта',
  completed: 'Поїздку завершено',
  cancelled: 'Замовлення скасовано',
}

const router = useRouter()
const { user, logout } = useAuth()
const geo = useGeolocation()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const online = ref(readOnline())
const orders = ref<OrderView[]>([])
const listState = ref<'loading' | 'ready' | 'error'>('loading')
const selectedId = ref<number | null>(null)
const active = ref<OrderView | null>(null)
const trips = ref<TripView[]>([])
const busy = ref(false)
const error = ref('')
const toast = ref('')
const tick = ref(0)
const completedFare = ref<number | null>(null)

let map: L.Map | null = null
let route: RouteLayer | null = null
let pickupMarker: L.Marker | null = null
let destMarker: L.Marker | null = null
let meMarker: L.Marker | null = null
const requestMarkers = new Map<number, L.Marker>()
let listTimer = 0
let activeTimer = 0
let clockTimer = 0
let toastTimer = 0
let unmounted = false

const firstName = computed(() => (typeof user.value?.first_name === 'string' ? user.value.first_name.slice(0, 40) : ''))
const selected = computed(() => orders.value.find((order) => order.id === selectedId.value) ?? null)
const focus = computed(() => active.value ?? selected.value)

const today = computed(() => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const list = trips.value.filter((trip) => trip.endedAt && Date.parse(trip.endedAt) >= start.getTime())
  return { count: list.length, earned: list.reduce((sum, trip) => sum + (trip.fare ?? 0), 0) }
})

const stepAction = computed(() => {
  switch (active.value?.stage) {
    case 'accepted':
      return { label: 'Я на місці', hint: 'Повідомте клієнта, що ви прибули' }
    case 'arrived':
      return { label: 'Почати поїздку', hint: 'Клієнт сів в авто? Можна рушати' }
    case 'started':
      return { label: 'Завершити поїздку', hint: 'Довезли клієнта до пункту призначення' }
    default:
      return null
  }
})

function readOnline() {
  try {
    return localStorage.getItem(ONLINE_KEY) !== '0'
  } catch {
    return true
  }
}

function flash(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200)
}

function toPickupLabel(order: OrderView) {
  const me = geo.position.value
  if (!me) return ''
  return formatDistance(distanceMeters(me, order.pickup))
}

function clientName(order: OrderView) {
  return fullName(order.client) || (order.clientId ? `Клієнт №${order.clientId}` : 'Клієнт')
}

function tripKm(order: OrderView) {
  return order.distanceKm ?? (distanceMeters(order.pickup, order.destination) * 1.35) / 1000
}

const isDesktop = () => window.matchMedia('(min-width: 721px)').matches

function fit(points: L.LatLngExpression[]) {
  if (!map || !points.length) return
  const desktop = isDesktop()
  map.flyToBounds(L.latLngBounds(points), {
    paddingTopLeft: desktop ? [480, 110] : [40, 90],
    paddingBottomRight: desktop ? [90, 80] : [40, Math.round(window.innerHeight * 0.55)],
    maxZoom: 16,
    duration: 0.8,
  })
}

function drawFocus() {
  if (!map || !route) return
  const order = focus.value
  route.clear()
  pickupMarker?.remove()
  destMarker?.remove()
  pickupMarker = null
  destMarker = null
  if (!order) return

  const points = route.draw(order.pickup, order.destination)
  pickupMarker = L.marker([order.pickup.lat, order.pickup.lng], { icon: icons.pickup, zIndexOffset: 600, title: 'Посадка' }).addTo(map)
  destMarker = L.marker([order.destination.lat, order.destination.lng], { icon: icons.destination, zIndexOffset: 800, title: 'Призначення' }).addTo(map)

  const me = geo.position.value
  fit(me && active.value?.stage === 'accepted' ? [...points, [me.lat, me.lng]] : points)
}

function syncRequestMarkers() {
  if (!map) return
  const visible = active.value ? [] : orders.value
  const ids = new Set(visible.map((order) => order.id))

  for (const [id, marker] of requestMarkers) {
    if (!ids.has(id)) {
      marker.remove()
      requestMarkers.delete(id)
    }
  }

  for (const order of visible) {
    const icon = requestIcon(formatFare(order.fare), order.id === selectedId.value)
    const existing = requestMarkers.get(order.id)
    if (existing) {
      existing.setIcon(icon)
      existing.setZIndexOffset(order.id === selectedId.value ? 900 : 0)
      continue
    }
    const marker = L.marker([order.pickup.lat, order.pickup.lng], { icon, title: clientName(order) })
      .addTo(map)
      .on('click', () => select(order.id))
    requestMarkers.set(order.id, marker)
  }
}

function select(id: number) {
  selectedId.value = selectedId.value === id ? null : id
  error.value = ''
  nextTick(() => document.getElementById(`req-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

async function loadList() {
  clearTimeout(listTimer)
  if (active.value || !online.value || unmounted) return
  try {
    const page = await driverApi.available()
    orders.value = page.data.filter((order) => order.stage === 'searching')
    listState.value = 'ready'
    if (selectedId.value !== null && !orders.value.some((order) => order.id === selectedId.value)) {
      selectedId.value = null
      flash('Це замовлення вже недоступне')
    }
  } catch {
    if (listState.value !== 'ready') listState.value = 'error'
  }
  if (!unmounted && online.value && !active.value) listTimer = window.setTimeout(loadList, LIST_POLL_MS)
}

async function pollActive() {
  clearTimeout(activeTimer)
  if (!active.value || unmounted || isFinal(active.value.stage)) return
  try {
    const next = await driverApi.get(active.value.id)
    if (next.stage === 'cancelled') {
      flash(next.cancellationReason ? `Клієнт скасував: ${next.cancellationReason}` : 'Клієнт скасував замовлення')
      backToList()
      return
    }
    active.value = next
  } catch {
    // keep showing the last known state; next poll will retry
  }
  activeTimer = window.setTimeout(pollActive, ACTIVE_POLL_MS)
}

async function loadTrips() {
  try {
    trips.value = (await driverApi.trips(1, 30)).data
  } catch {
    trips.value = []
  }
}

async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Не вдалося виконати дію. Спробуйте ще раз'
  } finally {
    busy.value = false
  }
}

const accept = () =>
  run(async () => {
    const order = selected.value
    if (!order) return
    try {
      active.value = await driverApi.accept(order.id)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        orders.value = orders.value.filter((item) => item.id !== order.id)
        selectedId.value = null
      }
      throw e
    }
    selectedId.value = null
    clearTimeout(listTimer)
    flash('Замовлення ваше! Прямуйте до клієнта')
    pollActive()
  })

const advance = () =>
  run(async () => {
    const order = active.value
    if (!order) return
    if (order.stage === 'accepted') {
      active.value = await driverApi.arrived(order.id)
    } else if (order.stage === 'arrived') {
      await driverApi.start(order.id)
      active.value = { ...order, stage: 'started', status: 'in_progress' }
    } else if (order.stage === 'started') {
      const trip = await driverApi.complete(order.id, Math.round(tripKm(order) * 10) / 10)
      completedFare.value = trip?.fare ?? order.fare
      active.value = { ...order, stage: 'completed', status: 'completed' }
      loadTrips()
    }
  })

function backToList() {
  clearTimeout(activeTimer)
  active.value = null
  completedFare.value = null
  error.value = ''
  listState.value = 'loading'
  loadList()
}

function toggleOnline() {
  online.value = !online.value
  try {
    localStorage.setItem(ONLINE_KEY, online.value ? '1' : '0')
  } catch {
    // preference only
  }
  if (online.value) {
    listState.value = 'loading'
    loadList()
  } else {
    clearTimeout(listTimer)
    orders.value = []
    selectedId.value = null
  }
}

function locate() {
  const me = geo.position.value
  if (me && map) {
    map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 15), { duration: 0.8 })
    return
  }
  if (geo.status.value === 'denied') flash('Доступ до геолокації заборонено в налаштуваннях браузера')
  else if (geo.status.value === 'unavailable') flash('Геолокація недоступна на цьому пристрої')
  else geo.start()
}

function zoom(delta: number) {
  map?.setZoom(map.getZoom() + delta)
}

function onLogout() {
  logout()
  router.replace('/')
}

watch(geo.position, (position) => {
  if (!position || !map) return
  if (!meMarker) meMarker = L.marker([position.lat, position.lng], { icon: icons.me, zIndexOffset: 1000, title: 'Ви тут' }).addTo(map)
  else meMarker.setLatLng([position.lat, position.lng])
})

watch(() => [focus.value?.id, focus.value?.pickup.lat, focus.value?.destination.lat], drawFocus)
watch([orders, selectedId, active], syncRequestMarkers, { deep: false })

onMounted(async () => {
  clockTimer = window.setInterval(() => tick.value++, 30_000)
  if (!mapEl.value) return
  map = createCityMap(mapEl.value)
  route = new RouteLayer(map)
  map.whenReady(() => (ready.value = true))
  map.on('click', () => {
    if (!active.value) selectedId.value = null
  })

  if ((await geo.permission()) === 'granted') geo.start()
  loadTrips()

  try {
    const mine = (await driverApi.assigned()).data.find((order) => !isFinal(order.stage))
    if (mine) {
      active.value = mine
      pollActive()
      return
    }
  } catch {
    // no assigned orders endpoint response — just show the queue
  }
  if (online.value) loadList()
  else listState.value = 'ready'
})

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(listTimer)
  clearTimeout(activeTimer)
  clearTimeout(toastTimer)
  clearInterval(clockTimer)
  requestMarkers.clear()
  map?.remove()
  map = null
  route = null
})
</script>

<template>
  <div class="page" :class="{ 'page--ready': ready }">
    <div ref="mapEl" class="map" role="application" aria-label="Карта замовлень"></div>
    <div class="veil" aria-hidden="true"></div>

    <header class="topbar">
      <RouterLink to="/" class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
        <span class="logo__tag">Водій</span>
      </RouterLink>

      <div class="topbar__right">
        <button
          type="button"
          class="status"
          :class="{ 'status--on': online }"
          :disabled="!!active"
          :aria-pressed="online"
          @click="toggleOnline"
        >
          <span class="status__track"><span class="status__thumb"></span></span>
          <span class="status__text">{{ online ? 'На лінії' : 'Офлайн' }}</span>
        </button>
        <button type="button" class="topbar__logout" aria-label="Вийти" @click="onLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </svg>
        </button>
      </div>
    </header>

    <aside class="panel" aria-label="Замовлення">
      <!-- Current order -->
      <template v-if="active">
        <div class="panel__head">
          <p class="panel__eyebrow">Замовлення № {{ active.id }}</p>
          <h1 class="panel__title">{{ ACTIVE_TITLE[active.stage] }}</h1>
        </div>

        <div class="panel__body">
          <template v-if="active.stage === 'completed'">
            <div class="done">
              <span class="done__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <p class="done__fare">{{ formatFare(completedFare ?? active.fare) }}</p>
              <p class="done__label">отримайте від клієнта</p>
            </div>
          </template>

          <div class="client">
            <span class="client__avatar">{{ initials(active.client, 'К') }}</span>
            <div class="client__info">
              <p class="client__name">{{ clientName(active) }}</p>
              <p class="client__meta">
                <template v-if="active.client?.rating">★ {{ active.client.rating.toFixed(1).replace('.', ',') }} · </template>
                {{ formatKm(tripKm(active)) }} · {{ formatFare(active.fare) }}
              </p>
            </div>
            <a
              v-if="active.client?.phone && active.stage !== 'completed'"
              class="client__call"
              :href="`tel:${active.client.phone.replace(/[^\d+]/g, '')}`"
              aria-label="Подзвонити клієнту"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              </svg>
            </a>
          </div>

          <div class="route">
            <p class="route__point route__point--from" :class="{ 'route__point--now': active.stage === 'accepted' || active.stage === 'arrived' }">
              <span class="route__label">Посадка</span>
              {{ active.pickup.address }}
            </p>
            <p class="route__point route__point--to" :class="{ 'route__point--now': active.stage === 'started' }">
              <span class="route__label">Призначення</span>
              {{ active.destination.address }}
            </p>
          </div>

          <p v-if="active.stage === 'accepted'" class="note">
            Клієнт бачить ваш профіль і може попросити іншого водія, поки ви не прибули
          </p>
        </div>

        <footer class="panel__foot">
          <Transition name="fade">
            <p v-if="error" class="alert" role="alert">{{ error }}</p>
          </Transition>
          <template v-if="stepAction">
            <p class="panel__hint">{{ stepAction.hint }}</p>
            <button type="button" class="cta" :disabled="busy" @click="advance">
              <span v-if="busy" class="spinner"></span>
              <template v-else>
                {{ stepAction.label }}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </template>
            </button>
          </template>
          <button v-else type="button" class="cta" @click="backToList">До нових замовлень</button>
        </footer>
      </template>

      <!-- Queue -->
      <template v-else>
        <div class="panel__head">
          <p class="panel__eyebrow">{{ firstName ? `Гарної зміни, ${firstName}` : 'Гарної зміни' }}</p>
          <h1 class="panel__title">Замовлення поруч</h1>
          <div class="stats">
            <div class="stats__item">
              <span class="stats__value">{{ orders.length }}</span>
              <span class="stats__label">чекають</span>
            </div>
            <div class="stats__item">
              <span class="stats__value">{{ today.count }}</span>
              <span class="stats__label">поїздок сьогодні</span>
            </div>
            <div class="stats__item">
              <span class="stats__value">{{ formatFare(today.earned) }}</span>
              <span class="stats__label">заробіток</span>
            </div>
          </div>
        </div>

        <div class="panel__body panel__body--list">
          <div v-if="!online" class="empty">
            <span class="empty__icon empty__icon--off">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0" />
              </svg>
            </span>
            <p class="empty__title">Ви офлайн</p>
            <p class="empty__text">Вийдіть на лінію, щоб бачити нові замовлення</p>
            <button type="button" class="cta cta--small" @click="toggleOnline">Вийти на лінію</button>
          </div>

          <div v-else-if="listState === 'loading'" class="skeletons">
            <span v-for="n in 3" :key="n" class="skeleton"></span>
          </div>

          <div v-else-if="listState === 'error'" class="empty">
            <p class="empty__title">Не вдалося завантажити замовлення</p>
            <button type="button" class="cta cta--small" @click="loadList">Спробувати ще раз</button>
          </div>

          <div v-else-if="!orders.length" class="empty">
            <span class="empty__radar" aria-hidden="true">
              <span></span>
              <span></span>
            </span>
            <p class="empty__title">Поки тихо</p>
            <p class="empty__text">Нові замовлення з'являться тут автоматично</p>
          </div>

          <TransitionGroup v-else name="list" tag="ul" class="list">
            <li
              v-for="(order, index) in orders"
              :id="`req-${order.id}`"
              :key="order.id"
              class="req"
              :class="{ 'req--active': order.id === selectedId }"
              :style="{ '--i': index }"
            >
              <button type="button" class="req__main" :aria-expanded="order.id === selectedId" @click="select(order.id)">
                <span class="req__avatar">{{ initials(order.client, 'К') }}</span>
                <span class="req__body">
                  <span class="req__top">
                    <span class="req__name">{{ clientName(order) }}</span>
                    <span class="req__fare">{{ formatFare(order.fare) }}</span>
                  </span>
                  <span class="req__route">
                    <span class="req__from">{{ order.pickup.address }}</span>
                    <span class="req__to">{{ order.destination.address }}</span>
                  </span>
                  <span class="req__meta">
                    <span>{{ formatKm(tripKm(order)) }}</span>
                    <span v-if="order.durationMin">≈ {{ order.durationMin }} хв</span>
                    <span v-if="toPickupLabel(order)" class="req__near">до клієнта {{ toPickupLabel(order) }}</span>
                    <span :key="tick" class="req__ago">{{ timeAgo(order.createdAt) }}</span>
                  </span>
                </span>
              </button>

              <div v-if="order.id === selectedId" class="req__actions">
                <p v-if="error" class="alert" role="alert">{{ error }}</p>
                <button type="button" class="cta" :disabled="busy" @click="accept">
                  <span v-if="busy" class="spinner"></span>
                  <template v-else>
                    Прийняти · {{ formatFare(order.fare) }}
                  </template>
                </button>
              </div>
            </li>
          </TransitionGroup>
        </div>
      </template>
    </aside>

    <div class="controls">
      <div class="controls__group">
        <button type="button" class="ctrl" aria-label="Наблизити" @click="zoom(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <span class="controls__sep"></span>
        <button type="button" class="ctrl" aria-label="Віддалити" @click="zoom(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14" /></svg>
        </button>
      </div>
      <button type="button" class="ctrl ctrl--solo" :class="{ 'ctrl--on': geo.status.value === 'watching' }" aria-label="Моє місцезнаходження" @click="locate">
        <span v-if="geo.status.value === 'requesting'" class="ctrl__spinner"></span>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
    </div>

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --glass: rgba(255, 253, 248, 0.94);
  --line: rgba(236, 229, 214, 0.9);
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #eef0e8;
}

.map {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.8s ease;
}

.page--ready .map {
  opacity: 1;
}

.veil {
  position: absolute;
  inset: 0 0 auto;
  z-index: 1;
  height: 160px;
  background: linear-gradient(180deg, rgba(251, 247, 238, 0.75), rgba(251, 247, 238, 0));
  pointer-events: none;
}

.topbar {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  z-index: 900;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 14px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--glass);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 32px rgba(40, 35, 20, 0.12);
  animation: drop 0.7s 0.2s var(--ease-out) backwards;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.logo__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #2b2b26;
  color: #fbf7ee;
  font-size: 19px;
  font-weight: 700;
}

.logo__name {
  font-size: 20px;
  font-weight: 700;
  color: #2b2b26;
}

.logo__name span {
  color: #2f7d57;
}

.logo__tag {
  padding: 4px 9px;
  border-radius: 8px;
  background: #2b2b26;
  color: #8fd1ab;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 8px 8px;
  border: none;
  border-radius: 14px;
  background: #f1ebdd;
  color: #6b675c;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.25s ease,
    color 0.25s ease;
}

.status:disabled {
  cursor: default;
}

.status--on {
  background: #e3efe7;
  color: #2f7d57;
}

.status__track {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: #cfc6b2;
  transition: background-color 0.25s ease;
}

.status--on .status__track {
  background: #2f7d57;
}

.status__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s cubic-bezier(0.34, 1.5, 0.5, 1);
}

.status--on .status__thumb {
  transform: translateX(16px);
}

.topbar__logout {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 13px;
  background: #f1ebdd;
  color: #4a473f;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.topbar__logout:hover {
  background: #fbeae6;
  color: #9f3a28;
}

.topbar__logout svg {
  width: 18px;
  height: 18px;
}

.panel {
  position: absolute;
  top: 92px;
  left: 16px;
  bottom: 16px;
  z-index: 950;
  display: flex;
  flex-direction: column;
  width: 440px;
  border: 1px solid var(--line);
  border-radius: 26px;
  background: var(--glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 24px 60px rgba(40, 35, 20, 0.16);
  overflow: hidden;
  animation: rise 0.7s 0.3s var(--ease-out) backwards;
}

.panel__head {
  padding: 22px 20px 14px;
}

.panel__eyebrow {
  margin: 0 0 2px;
  font-size: 13.5px;
  font-weight: 600;
  color: #2f7d57;
}

.panel__title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #2b2b26;
}

.panel__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
  padding: 4px 20px 16px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #e0d8c6 transparent;
}

.panel__body--list {
  padding: 4px 12px 16px;
}

.panel__foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 20px 20px;
  border-top: 1px solid #efe8d9;
}

.panel__hint {
  margin: 0;
  font-size: 13px;
  text-align: center;
  color: #8a8578;
}

.stats {
  display: grid;
  grid-template-columns: 0.8fr 1fr 1.2fr;
  gap: 1px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 16px;
  background: rgba(251, 247, 238, 0.14);
}

.stats__item {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  background: #2b2b26;
  color: #fbf7ee;
}

.stats__value {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.stats__label {
  font-size: 11.5px;
  color: #b8b2a2;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.req {
  border: 1.5px solid #ece5d6;
  border-radius: 20px;
  background: #fffdf8;
  overflow: hidden;
  animation: item-in 0.45s calc(var(--i) * 50ms) var(--ease-out) backwards;
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease,
    transform 0.25s var(--ease-out);
}

.req:hover {
  border-color: #d6cdb8;
}

.req--active {
  border-color: #2f7d57;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(47, 125, 87, 0.16);
}

.req__main {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border: none;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.req__avatar,
.client__avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #e3efe7, #cfe4d7);
  color: #2f7d57;
  font-size: 15px;
  font-weight: 700;
}

.req--active .req__avatar {
  background: linear-gradient(135deg, #2f7d57, #5aa57d);
  color: #fbf7ee;
}

.req__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.req__top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.req__name {
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  color: #2b2b26;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.req__fare {
  flex-shrink: 0;
  font-size: 17px;
  font-weight: 800;
  color: #2f7d57;
}

.req__route {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 18px;
}

.req__route::before {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 4px;
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 3px, transparent 3px 6px);
}

.req__from,
.req__to {
  position: relative;
  overflow: hidden;
  font-size: 13.5px;
  color: #4a473f;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.req__from::before,
.req__to::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -18px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transform: translateY(-50%);
}

.req__from::before {
  border: 3px solid #2f7d57;
  background: #ffffff;
}

.req__to::before {
  border-radius: 2px;
  background: #2b2b26;
  transform: translateY(-50%) rotate(45deg) scale(0.8);
}

.req__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: #8a8578;
}

.req__near {
  color: #2f7d57;
  font-weight: 600;
}

.req__ago {
  margin-left: auto;
}

.req__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 14px 14px;
  animation: item-in 0.3s var(--ease-out) backwards;
}

.client {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1.5px solid #ece5d6;
  border-radius: 20px;
  background: #ffffff;
}

.client__avatar {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #2f7d57, #5aa57d);
  color: #fbf7ee;
  font-size: 18px;
}

.client__info {
  flex: 1;
  min-width: 0;
}

.client__name {
  margin: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  color: #2b2b26;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.client__meta {
  margin: 3px 0 0;
  font-size: 13px;
  color: #8a8578;
}

.client__call {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #e3efe7;
  color: #2f7d57;
}

.client__call svg {
  width: 20px;
  height: 20px;
}

.route {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 14px 14px 40px;
  border-radius: 18px;
  background: #f8f4ea;
}

.route::before {
  content: '';
  position: absolute;
  top: 30px;
  bottom: 30px;
  left: 19px;
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 3px, transparent 3px 6px);
}

.route__point {
  position: relative;
  margin: 0;
  font-size: 14.5px;
  font-weight: 500;
  line-height: 1.35;
  color: #2b2b26;
}

.route__point::before {
  content: '';
  position: absolute;
  top: 22px;
  left: -27px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.route__point--from::before {
  border: 3.5px solid #2f7d57;
  background: #ffffff;
}

.route__point--to::before {
  border-radius: 3px;
  background: #2b2b26;
  transform: rotate(45deg) scale(0.85);
}

.route__point--now::before {
  box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.5);
  animation: ping 1.6s infinite;
}

.route__label {
  display: block;
  margin-bottom: 2px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a8578;
}

.note {
  margin: 0;
  padding: 10px 12px;
  border-radius: 14px;
  background: #e3efe7;
  color: #2b5c43;
  font-size: 13px;
  line-height: 1.4;
}

.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0 4px;
}

.done__icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 10px;
  border-radius: 50%;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 14px 34px rgba(47, 125, 87, 0.35);
  animation: pop 0.6s cubic-bezier(0.34, 1.6, 0.5, 1) backwards;
}

.done__icon svg {
  width: 32px;
  height: 32px;
}

.done__fare {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #2b2b26;
}

.done__label {
  margin: 2px 0 0;
  font-size: 13px;
  color: #8a8578;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 36px 20px;
  text-align: center;
}

.empty__icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 14px;
  border-radius: 50%;
  background: #f1ebdd;
  color: #8a8578;
}

.empty__icon svg {
  width: 28px;
  height: 28px;
}

.empty__radar {
  position: relative;
  width: 84px;
  height: 84px;
  margin-bottom: 16px;
}

.empty__radar::after {
  content: '';
  position: absolute;
  inset: 32px;
  border-radius: 50%;
  background: #2f7d57;
}

.empty__radar span {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(47, 125, 87, 0.35);
  border-radius: 50%;
  animation: radar 2.4s ease-out infinite;
}

.empty__radar span + span {
  animation-delay: 1.2s;
}

.empty__title {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 700;
  color: #2b2b26;
}

.empty__text {
  margin: 0 0 16px;
  font-size: 14px;
  color: #8a8578;
}

.skeletons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton {
  height: 118px;
  border-radius: 20px;
  background: linear-gradient(90deg, #f1ebdd 25%, #f8f4ea 50%, #f1ebdd 75%);
  background-size: 200% 100%;
  animation: shimmer 1.1s linear infinite;
}

.cta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 56px;
  border: none;
  border-radius: 18px;
  background: #2f7d57;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 14px 32px rgba(47, 125, 87, 0.32);
  transition:
    background-color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.cta:hover:not(:disabled) {
  background: #266a49;
  transform: translateY(-1px);
}

.cta:active:not(:disabled) {
  transform: scale(0.98);
}

.cta:disabled {
  cursor: progress;
  opacity: 0.85;
}

.cta svg {
  width: 20px;
  height: 20px;
}

.cta--small {
  width: auto;
  height: 46px;
  padding: 0 20px;
  font-size: 14.5px;
}

.alert {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: #fbeae6;
  color: #9f3a28;
  font-size: 13.5px;
  font-weight: 500;
}

.spinner,
.ctrl__spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid rgba(251, 247, 238, 0.35);
  border-top-color: #fbf7ee;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.ctrl__spinner {
  border-color: #e3efe7;
  border-top-color: #2f7d57;
}

.controls {
  position: absolute;
  right: 20px;
  bottom: 32px;
  z-index: 900;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.controls__group,
.ctrl--solo {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--glass);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.14);
  overflow: hidden;
}

.controls__group {
  display: flex;
  flex-direction: column;
}

.controls__sep {
  height: 1px;
  margin: 0 10px;
  background: #ece5d6;
}

.ctrl {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: none;
  background: transparent;
  color: #2b2b26;
  cursor: pointer;
}

.ctrl:hover {
  background: #f1ebdd;
}

.ctrl--solo {
  background: var(--glass);
}

.ctrl--on {
  color: #2f7d57;
}

.ctrl svg {
  width: 22px;
  height: 22px;
}

.toast {
  position: absolute;
  left: calc(50% + 228px);
  bottom: 32px;
  z-index: 1100;
  max-width: min(440px, calc(100% - 32px));
  padding: 12px 18px;
  border-radius: 14px;
  background: #2b2b26;
  color: #fbf7ee;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  transform: translateX(-50%);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.25);
}

.list-enter-active {
  transition:
    opacity 0.35s ease,
    transform 0.45s var(--ease-out);
}

.list-leave-active {
  position: absolute;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.list-move {
  transition: transform 0.4s var(--ease-out);
}

.list-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-enter-active {
  transition:
    opacity 0.25s ease,
    translate 0.4s var(--ease-out);
}

.toast-leave-active {
  transition: opacity 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  translate: 0 10px;
}

.toast-leave-to {
  opacity: 0;
}

@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

@keyframes item-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes radar {
  from {
    opacity: 1;
    transform: scale(0.4);
  }
  to {
    opacity: 0;
    transform: scale(1.1);
  }
}

@keyframes ping {
  0% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.5);
  }
  70%,
  100% {
    box-shadow: 0 0 0 8px rgba(47, 125, 87, 0);
  }
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.3);
  }
}

@media (max-width: 720px) {
  .topbar {
    top: calc(10px + env(safe-area-inset-top));
    left: 10px;
    right: 10px;
    padding: 8px 8px 8px 12px;
    border-radius: 18px;
  }

  .logo__icon {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }

  .logo__name {
    display: none;
  }

  .status {
    padding: 6px 12px 6px 6px;
    font-size: 13px;
  }

  .panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 58dvh;
    border-bottom: none;
    border-radius: 26px 26px 0 0;
  }

  .panel__head {
    padding: 16px 16px 10px;
  }

  .panel__eyebrow {
    display: none;
  }

  .panel__title {
    font-size: 21px;
  }

  .stats {
    margin-top: 10px;
  }

  .stats__item {
    padding: 9px 12px;
  }

  .stats__value {
    font-size: 15px;
  }

  .panel__body {
    padding: 4px 16px 12px;
  }

  .panel__body--list {
    padding: 4px 8px 12px;
  }

  .panel__foot {
    padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
  }

  .controls {
    top: calc(80px + env(safe-area-inset-top));
    right: 10px;
    bottom: auto;
  }

  .ctrl {
    width: 42px;
    height: 42px;
  }

  .toast {
    top: calc(80px + env(safe-area-inset-top));
    left: 50%;
    bottom: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel,
  .topbar,
  .req {
    animation: none;
  }
}
</style>
