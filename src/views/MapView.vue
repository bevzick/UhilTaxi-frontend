<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import L from 'leaflet'
import AddressInput from '@/components/AddressInput.vue'
import OrderSheet from '@/components/OrderSheet.vue'
import RideStatus from '@/components/RideStatus.vue'
import { isAbort, reverseGeocode } from '@/api/geocode'
import { CITY, inCity } from '@/config/city'
import { useActiveOrder } from '@/composables/useActiveOrder'
import { useAuth } from '@/composables/useAuth'
import { useGeolocation } from '@/composables/useGeolocation'
import { coordsLabel, curvePoints, distanceMeters, formatDistance } from '@/utils/geo'
import { RouteLayer, createCityMap, icons } from '@/utils/map'
import type { Place } from '@/types/geo'
import type { CreateOrderRequest, OrderView } from '@/types/order'

type Target = 'pickup' | 'destination'

const REGEOCODE_METERS = 60
const ROAD_FACTOR = 1.35
const CITY_SPEED_M_PER_MIN = 28_000 / 60

const QUICK_PLACES: { id: string; label: string; place: Place }[] = [
  { id: 'rail', label: 'Залізничний вокзал', place: { lat: 49.418024, lng: 27.010897, address: 'Залізничний вокзал, вулиця Шевченка' } },
  { id: 'bus', label: 'Автовокзал №1', place: { lat: 49.432354, lng: 27.025776, address: 'Автовокзал №1, Вінницьке шосе, 23' } },
  { id: 'square', label: 'Майдан Незалежності', place: { lat: 49.419664, lng: 26.979381, address: 'майдан Незалежності' } },
  { id: 'oasis', label: 'ТРЦ «Оазис»', place: { lat: 49.432811, lng: 26.983998, address: 'ТРЦ «Оазис», вулиця Степана Бандери, 2а' } },
  { id: 'hospital', label: 'Обласна лікарня', place: { lat: 49.412308, lng: 27.002948, address: 'Обласна лікарня, вулиця Гетьмана Мазепи' } },
]

const router = useRouter()
const { user, logout } = useAuth()
const geo = useGeolocation()
const ride = useActiveOrder()

const mapEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const pickup = ref<Place | null>(null)
const destination = ref<Place | null>(null)
const myPlace = ref<Place | null>(null)
const sheetOpen = ref(false)
const following = ref(true)
const picking = ref<Target | null>(null)
const toast = ref('')
const ready = ref(false)

const firstName = computed(() => {
  const name = user.value?.first_name
  return typeof name === 'string' ? name.slice(0, 40) : ''
})

const locateState = computed(() => {
  if (geo.status.value === 'watching') return following.value ? 'following' : 'on'
  if (geo.status.value === 'requesting') return 'loading'
  if (geo.status.value === 'denied' || geo.status.value === 'unavailable') return 'off'
  return 'idle'
})

const outsideCity = computed(() => {
  const position = geo.position.value
  return !!position && !inCity(position.lat, position.lng)
})

const geoNote = computed<{ text: string; action?: string; tone: 'info' | 'warn' } | null>(() => {
  if (pickup.value) return null
  const status = geo.status.value
  if (status === 'requesting') return { text: 'Визначаємо, де ви…', tone: 'info' }
  if (status === 'watching' && outsideCity.value) {
    return { text: 'Схоже, ви поза Хмельницьким — вкажіть адресу посадки', tone: 'warn' }
  }
  if (status === 'denied') return { text: 'Геолокацію вимкнено — просто введіть адресу посадки', tone: 'warn' }
  if (status === 'unavailable' || status === 'error') {
    return { text: 'Не вдалося визначити місцезнаходження — введіть адресу посадки', tone: 'warn' }
  }
  if (status === 'idle') {
    return { text: 'Увімкніть геолокацію — і адреса посадки заповниться сама', action: 'Увімкнути', tone: 'info' }
  }
  return null
})

const routeReady = computed(
  () => !!pickup.value && !!destination.value && !pickup.value.pending && !destination.value.pending,
)

const routeStats = computed(() => {
  if (!routeReady.value || !pickup.value || !destination.value) return null
  const meters = distanceMeters(pickup.value, destination.value) * ROAD_FACTOR
  return { distance: formatDistance(meters), minutes: Math.max(3, Math.round(meters / CITY_SPEED_M_PER_MIN)) }
})

const ctaText = computed(() => {
  if (!destination.value) return 'Вкажіть, куди їхати'
  if (!pickup.value) return 'Вкажіть, звідки їхати'
  if (pickup.value.pending || destination.value.pending) return 'Визначаємо адресу…'
  return 'Обрати авто'
})

const activeQuick = computed(() => {
  const place = destination.value
  if (!place) return ''
  return QUICK_PLACES.find((item) => item.place.lat === place.lat && item.place.lng === place.lng)?.id ?? ''
})

let map: L.Map | null = null
let meMarker: L.Marker | null = null
let accuracyCircle: L.Circle | null = null
let pickupMarker: L.Marker | null = null
let destMarker: L.Marker | null = null
let route: RouteLayer | null = null
let lastRouteKey = ''
let lastGeocoded: { lat: number; lng: number } | null = null
let meController: AbortController | null = null
let toastTimer = 0
let centeredOnMe = false
const pointControllers: Record<Target, AbortController | null> = { pickup: null, destination: null }

function flash(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200)
}

const isDesktop = () => window.matchMedia('(min-width: 721px)').matches

function fitRoute(points: L.LatLngExpression[]) {
  if (!map) return
  const bounds = L.latLngBounds(points)
  const leftPanel = !sheetOpen.value
  if (isDesktop()) {
    map.flyToBounds(bounds, {
      paddingTopLeft: [leftPanel ? 470 : 80, 110],
      paddingBottomRight: [sheetOpen.value ? 480 : 90, 80],
      maxZoom: 16,
      duration: 0.9,
    })
    return
  }
  const panelBottom = panelEl.value?.getBoundingClientRect().bottom ?? 300
  const bottomCard = sheetOpen.value || !!ride.order.value
  map.flyToBounds(bounds, {
    paddingTopLeft: [40, bottomCard ? 90 : panelBottom + 30],
    paddingBottomRight: [40, bottomCard ? Math.round(window.innerHeight * 0.55) : 110],
    maxZoom: 16,
    duration: 0.9,
  })
}

function routePoints() {
  if (!pickup.value || !destination.value) return null
  return curvePoints([pickup.value.lat, pickup.value.lng], [destination.value.lat, destination.value.lng])
}

function drawRoute() {
  if (!map || !route) return
  route.clear()

  if (!pickup.value || !destination.value) {
    lastRouteKey = ''
    return
  }

  const points = route.draw(pickup.value, destination.value)
  const from = pickup.value
  const to = destination.value
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`
  if (key !== lastRouteKey) {
    lastRouteKey = key
    following.value = false
    fitRoute(points)
  }
}

function getPoint(target: Target) {
  return target === 'pickup' ? pickup.value : destination.value
}

function setPoint(target: Target, place: Place | null) {
  if (target === 'pickup') pickup.value = place
  else destination.value = place
}

async function resolvePoint(target: Target, lat: number, lng: number) {
  pointControllers[target]?.abort()
  const controller = new AbortController()
  pointControllers[target] = controller
  setPoint(target, { lat, lng, address: '', source: 'map', pending: true })

  try {
    const place = await reverseGeocode(lat, lng, controller.signal)
    const current = getPoint(target)
    if (current?.lat === lat && current.lng === lng) setPoint(target, { ...place, source: 'map' })
  } catch (error) {
    if (isAbort(error)) return
    setPoint(target, { lat, lng, address: coordsLabel(lat, lng), source: 'map' })
  }
}

function placeAt(target: Target, latlng: L.LatLng) {
  if (ride.order.value) return
  if (!inCity(latlng.lat, latlng.lng)) {
    flash('Ми працюємо лише в межах Хмельницького')
    return
  }
  resolvePoint(target, latlng.lat, latlng.lng)
}

function startPick(target: Target) {
  picking.value = picking.value === target ? null : target
}

function chooseQuick(place: Place) {
  pointControllers.destination?.abort()
  destination.value = { ...place, source: 'search' }
}

function swap() {
  const from = pickup.value
  pickup.value = destination.value
  destination.value = from
}

function useMe() {
  if (myPlace.value) pickup.value = { ...myPlace.value }
}

function openSheet() {
  if (!routeReady.value) return
  picking.value = null
  sheetOpen.value = true
}

function onOrderCreated(order: OrderView, request: CreateOrderRequest) {
  ride.start(order, request)
  sheetOpen.value = false
}

function onRideDone() {
  ride.clear()
  sheetOpen.value = false
  destination.value = null
  pickup.value = myPlace.value ? { ...myPlace.value } : null
}

function showOrderRoute(order: OrderView) {
  const same = (place: Place | null, point: { lat: number; lng: number }) =>
    !!place && place.lat === point.lat && place.lng === point.lng
  if (!same(pickup.value, order.pickup)) pickup.value = { ...order.pickup, source: 'search' }
  if (!same(destination.value, order.destination)) destination.value = { ...order.destination, source: 'search' }
}

async function updateMyPlace(lat: number, lng: number) {
  if (!inCity(lat, lng)) {
    myPlace.value = null
    return
  }
  if (lastGeocoded && distanceMeters(lastGeocoded, { lat, lng }) < REGEOCODE_METERS) return

  lastGeocoded = { lat, lng }
  const draft: Place = { lat, lng, address: '', source: 'me', pending: true }
  myPlace.value = draft
  if (!ride.order.value && (!pickup.value || pickup.value.source === 'me')) pickup.value = draft

  meController?.abort()
  meController = new AbortController()

  try {
    const place = await reverseGeocode(lat, lng, meController.signal)
    const resolved: Place = { ...place, source: 'me' }
    myPlace.value = resolved
    if (!ride.order.value && (!pickup.value || pickup.value.source === 'me')) pickup.value = resolved
  } catch (error) {
    if (isAbort(error)) return
    const fallback: Place = { lat, lng, address: 'Моє місцезнаходження', source: 'me' }
    myPlace.value = fallback
    if (!ride.order.value && (!pickup.value || pickup.value.source === 'me')) pickup.value = fallback
  }
}

function onLocate() {
  if (!map) return
  if (geo.status.value === 'watching' && geo.position.value) {
    const { lat, lng } = geo.position.value
    if (!inCity(lat, lng)) {
      flash('Схоже, ви зараз поза Хмельницьким')
      return
    }
    following.value = true
    map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
    return
  }
  if (geo.status.value === 'denied') {
    flash('Доступ до геолокації заборонено. Увімкніть його в налаштуваннях браузера')
    return
  }
  if (geo.status.value === 'unavailable') {
    flash('Геолокація недоступна на цьому пристрої')
    return
  }
  geo.start()
}

function zoom(delta: number) {
  map?.setZoom(map.getZoom() + delta)
}

function onLogout() {
  logout()
  router.replace('/')
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && picking.value) picking.value = null
}

function bindDrag(marker: L.Marker, target: Target) {
  marker.on('dragend', () => {
    const point = marker.getLatLng()
    if (!inCity(point.lat, point.lng)) {
      flash('Ми працюємо лише в межах Хмельницького')
      const current = getPoint(target)
      if (current) marker.setLatLng([current.lat, current.lng])
      return
    }
    resolvePoint(target, point.lat, point.lng)
  })
  return marker
}

watch(geo.position, (position) => {
  if (!position || !map) return
  const { lat, lng, accuracy } = position
  const latlng = L.latLng(lat, lng)

  if (!meMarker) {
    meMarker = L.marker(latlng, { icon: icons.me, zIndexOffset: 1000, title: 'Ви тут', riseOnHover: true })
      .addTo(map)
      .on('click', useMe)
    accuracyCircle = L.circle(latlng, {
      radius: Math.min(accuracy, 500),
      stroke: false,
      fillColor: '#2f7d57',
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(map)
  } else {
    meMarker.setLatLng(latlng)
    accuracyCircle?.setLatLng(latlng).setRadius(Math.min(accuracy, 500))
  }

  if (!inCity(lat, lng)) {
    centeredOnMe = true
  } else if (!centeredOnMe) {
    centeredOnMe = true
    if (!destination.value) map.flyTo(latlng, 16, { duration: 1.2 })
  } else if (following.value && !sheetOpen.value && !destination.value) {
    map.panTo(latlng, { animate: true })
  }

  updateMyPlace(lat, lng)
})

watch(pickup, (place) => {
  if (!map) return
  if (!place || place.source === 'me') {
    pickupMarker?.remove()
    pickupMarker = null
  } else if (!pickupMarker) {
    pickupMarker = bindDrag(
      L.marker([place.lat, place.lng], { icon: icons.pickup, draggable: true, autoPan: true, zIndexOffset: 500, title: 'Звідки' }),
      'pickup',
    ).addTo(map)
  } else {
    pickupMarker.setLatLng([place.lat, place.lng])
  }
  drawRoute()
})

watch(destination, (place) => {
  if (!map) return
  if (!place) {
    destMarker?.remove()
    destMarker = null
  } else if (!destMarker) {
    destMarker = bindDrag(
      L.marker([place.lat, place.lng], { icon: icons.destination, draggable: true, autoPan: true, zIndexOffset: 800, title: 'Куди' }),
      'destination',
    ).addTo(map)
  } else {
    destMarker.setLatLng([place.lat, place.lng])
  }
  drawRoute()
})

watch(
  () => ride.order.value?.id,
  async () => {
    if (!ride.order.value) return
    showOrderRoute(ride.order.value)
    await nextTick()
    const points = routePoints()
    if (points) fitRoute(points)
  },
)

watch(sheetOpen, async () => {
  await nextTick()
  const points = routePoints()
  if (points) fitRoute(points)
})

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (!mapEl.value) return
  map = createCityMap(mapEl.value)
  route = new RouteLayer(map)
  if (ride.order.value) showOrderRoute(ride.order.value)
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (!picking.value) return
    placeAt(picking.value, event.latlng)
    picking.value = null
  })
  map.on('dblclick', (event: L.LeafletMouseEvent) => placeAt('destination', event.latlng))
  map.on('contextmenu', (event: L.LeafletMouseEvent) => placeAt('destination', event.latlng))
  map.on('dragstart', () => (following.value = false))
  map.whenReady(() => (ready.value = true))

  if ((await geo.permission()) === 'granted') geo.start()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(toastTimer)
  meController?.abort()
  pointControllers.pickup?.abort()
  pointControllers.destination?.abort()
  map?.remove()
  map = null
  route = null
})
</script>

<template>
  <div
    class="page"
    :class="{ 'page--ready': ready, 'page--picking': picking, 'page--sheet': sheetOpen, 'page--ride': ride.order.value }"
  >
    <div ref="mapEl" class="map" role="application" aria-label="Карта Хмельницького"></div>
    <div class="veil" aria-hidden="true"></div>

    <header class="topbar">
      <RouterLink to="/" class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
      </RouterLink>

      <div class="topbar__right">
        <span class="topbar__city">
          <span class="topbar__live"></span>
          {{ CITY.name }}
        </span>
        <button type="button" class="topbar__logout" @click="onLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </svg>
          <span>Вийти</span>
        </button>
      </div>
    </header>

    <Transition name="dock">
      <div v-show="!sheetOpen && !ride.order.value" class="dock">
        <section ref="panelEl" class="panel" aria-label="Маршрут">
          <div class="panel__head">
            <p class="panel__eyebrow">{{ firstName ? `Привіт, ${firstName}` : 'Привіт' }}</p>
            <h1 class="panel__title">Куди їдемо?</h1>
          </div>

          <div class="route">
            <AddressInput
              v-model="pickup"
              input-id="route-from"
              variant="from"
              label="Звідки"
              :placeholder="geo.status.value === 'requesting' ? 'Визначаємо, де ви…' : 'Адреса посадки'"
            />
            <button
              type="button"
              class="pick"
              :class="{ 'pick--active': picking === 'pickup' }"
              :aria-pressed="picking === 'pickup'"
              aria-label="Обрати місце посадки на карті"
              title="Обрати на карті"
              @click="startPick('pickup')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
            </button>

            <AddressInput
              v-model="destination"
              input-id="route-to"
              variant="to"
              label="Куди"
              placeholder="Введіть адресу або місце"
            />
            <button
              type="button"
              class="pick"
              :class="{ 'pick--active': picking === 'destination' }"
              :aria-pressed="picking === 'destination'"
              aria-label="Обрати пункт призначення на карті"
              title="Обрати на карті"
              @click="startPick('destination')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
            </button>

            <button
              type="button"
              class="route__swap"
              aria-label="Поміняти місцями"
              :disabled="!pickup && !destination"
              @click="swap"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
              </svg>
            </button>
          </div>

          <Transition name="fade">
            <div v-if="geoNote" class="note" :class="`note--${geoNote.tone}`">
              <span class="note__icon" aria-hidden="true">
                <span v-if="geo.status.value === 'requesting'" class="note__spinner"></span>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="2.5" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </span>
              <span class="note__text">{{ geoNote.text }}</span>
              <button v-if="geoNote.action" type="button" class="note__btn" @click="geo.start()">
                {{ geoNote.action }}
              </button>
            </div>
            <button
              v-else-if="myPlace && pickup?.source !== 'me'"
              type="button"
              class="note note--info note--button"
              @click="useMe"
            >
              <span class="note__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </span>
              <span class="note__text">Їхати з мого місцезнаходження</span>
            </button>
          </Transition>

          <div class="quick">
            <p class="quick__title">Популярні місця</p>
            <div class="quick__list">
              <button
                v-for="(item, index) in QUICK_PLACES"
                :key="item.id"
                type="button"
                class="quick__chip"
                :class="{ 'quick__chip--active': activeQuick === item.id }"
                :style="{ '--i': index }"
                @click="chooseQuick(item.place)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <Transition name="stats">
            <div v-if="routeStats" class="stats">
              <div class="stats__item">
                <span class="stats__value">{{ routeStats.distance }}</span>
                <span class="stats__label">відстань</span>
              </div>
              <span class="stats__sep"></span>
              <div class="stats__item">
                <span class="stats__value">≈ {{ routeStats.minutes }} хв</span>
                <span class="stats__label">у дорозі</span>
              </div>
              <span class="stats__car" aria-hidden="true">
                <svg viewBox="0 0 48 24">
                  <path d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" />
                  <circle cx="14" cy="18" r="3.2" fill="currentColor" />
                  <circle cx="35" cy="18" r="3.2" fill="currentColor" />
                </svg>
              </span>
            </div>
          </Transition>
        </section>

        <Transition name="swap" mode="out-in">
          <div v-if="picking" key="picking" class="picking" role="status">
            <span class="picking__pulse" aria-hidden="true"></span>
            <span class="picking__text">
              Торкніться карти, щоб обрати <strong>{{ picking === 'pickup' ? 'звідки' : 'куди' }}</strong>
            </span>
            <button type="button" class="picking__cancel" @click="picking = null">Скасувати</button>
          </div>
          <button v-else key="cta" type="button" class="cta" :disabled="!routeReady" @click="openSheet">
            <span class="cta__shine"></span>
            <span class="cta__text">{{ ctaText }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </Transition>
      </div>
    </Transition>

    <div class="controls" :class="{ 'controls--shifted': sheetOpen }">
      <div class="controls__group">
        <button type="button" class="ctrl" aria-label="Наблизити" @click="zoom(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <span class="controls__sep"></span>
        <button type="button" class="ctrl" aria-label="Віддалити" @click="zoom(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="ctrl ctrl--locate"
        :class="`ctrl--${locateState}`"
        :aria-label="locateState === 'off' ? 'Геолокація недоступна' : 'Моє місцезнаходження'"
        @click="onLocate"
      >
        <span v-if="locateState === 'loading'" class="ctrl__spinner"></span>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.5" :fill="locateState === 'following' ? 'currentColor' : 'none'" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <path v-if="locateState === 'off'" d="M4 4l16 16" />
        </svg>
      </button>
    </div>

    <Transition name="dock">
      <div v-if="ride.order.value" class="ride-dock">
        <RideStatus
          :order="ride.order.value"
          :confirmed="ride.confirmed.value"
          :needs-decision="ride.needsDecision.value"
          :busy="ride.busy.value"
          :error="ride.error.value"
          :researching="ride.researching.value"
          @confirm="ride.confirmDriver"
          @reject="ride.rejectDriver"
          @cancel="ride.cancel()"
          @done="onRideDone"
        />
      </div>
    </Transition>

    <OrderSheet
      v-model:pickup="pickup"
      v-model:destination="destination"
      :open="sheetOpen"
      :my-place="myPlace"
      @close="sheetOpen = false"
      @created="onOrderCreated"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --glass: rgba(255, 253, 248, 0.92);
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
  transform: scale(1.04);
  transition:
    opacity 0.8s ease,
    transform 1.2s var(--ease-out);
}

.page--ready .map {
  opacity: 1;
  transform: scale(1);
}

.ride-dock {
  position: absolute;
  top: 92px;
  left: 16px;
  z-index: 950;
  width: 410px;
  max-height: calc(100% - 116px);
  overflow-y: auto;
  border-radius: 26px;
  scrollbar-width: none;
}

.page--picking .map {
  cursor: crosshair;
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
  background: #2f7d57;
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

.topbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.topbar__city {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: #e3efe7;
  color: #2f7d57;
  font-size: 13.5px;
  font-weight: 600;
}

.topbar__live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2f7d57;
  animation: live 2s infinite;
}

.topbar__logout {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  border-radius: 13px;
  background: #f1ebdd;
  color: #4a473f;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
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

/* Dock: route panel + action, stacked on the left (desktop) or split top/bottom (mobile) */
.dock {
  position: absolute;
  top: 92px;
  left: 16px;
  bottom: 24px;
  z-index: 950;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 410px;
  pointer-events: none;
}

.dock > * {
  pointer-events: auto;
}

.panel {
  padding: 22px 20px 18px;
  border: 1px solid var(--line);
  border-radius: 26px;
  background: var(--glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 24px 60px rgba(40, 35, 20, 0.16);
  animation: rise 0.7s 0.3s var(--ease-out) backwards;
}

.panel__eyebrow {
  margin: 0 0 2px;
  font-size: 13.5px;
  font-weight: 600;
  color: #2f7d57;
}

.panel__title {
  margin: 0 0 16px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #2b2b26;
}

.route {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 10px 8px;
}

.route::before {
  content: '';
  position: absolute;
  top: 36px;
  bottom: 36px;
  left: 22px;
  z-index: 1;
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 4px, transparent 4px 8px);
  pointer-events: none;
}

.pick {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1.5px solid #e6dfcf;
  border-radius: 14px;
  background: #fffdf8;
  color: #6b675c;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.pick:hover {
  border-color: #2f7d57;
  color: #2f7d57;
  transform: translateY(-1px);
}

.pick--active {
  border-color: #2f7d57;
  background: #2f7d57;
  color: #fbf7ee;
  animation: pick-pulse 1.4s ease-out infinite;
}

.pick--active:hover {
  color: #fbf7ee;
}

.pick svg {
  width: 20px;
  height: 20px;
}

.route__swap {
  position: absolute;
  top: 50%;
  right: 66px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid #e6dfcf;
  border-radius: 50%;
  background: #fffdf8;
  color: #4a473f;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(40, 35, 20, 0.08);
  transform: translateY(-50%);
  transition:
    transform 0.4s var(--ease-out),
    border-color 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;
}

.route__swap:hover:not(:disabled) {
  border-color: #2f7d57;
  color: #2f7d57;
  transform: translateY(-50%) rotate(180deg);
}

.route__swap:disabled {
  opacity: 0.5;
  cursor: default;
}

.route__swap svg {
  width: 15px;
  height: 15px;
}

.note {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 12px;
  padding: 10px 10px 10px 12px;
  border: none;
  border-radius: 14px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
}

.note--info {
  background: #e3efe7;
  color: #2b5c43;
}

.note--warn {
  background: #f7eedb;
  color: #7a5a1e;
}

.note--button {
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.2s var(--ease-out);
}

.note--button:hover {
  transform: translateY(-1px);
}

.note__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.note__icon svg {
  width: 18px;
  height: 18px;
}

.note__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(47, 125, 87, 0.2);
  border-top-color: #2f7d57;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.note__text {
  flex: 1;
}

.note__btn {
  flex-shrink: 0;
  padding: 7px 12px;
  border: none;
  border-radius: 10px;
  background: #2f7d57;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.note__btn:hover {
  background: #266a49;
}

.quick {
  margin-top: 16px;
}

.quick__title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a8578;
}

.quick__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick__chip {
  padding: 8px 12px;
  border: 1.5px solid #e6dfcf;
  border-radius: 999px;
  background: #fffdf8;
  color: #4a473f;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  animation: chip-in 0.45s calc(0.5s + var(--i) * 50ms) var(--ease-out) backwards;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.quick__chip:hover {
  border-color: #2f7d57;
  color: #2f7d57;
  transform: translateY(-1px);
}

.quick__chip--active {
  border-color: #2f7d57;
  background: #2f7d57;
  color: #fbf7ee;
}

.quick__chip--active:hover {
  color: #fbf7ee;
}

.stats {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #2b2b26;
  color: #fbf7ee;
  overflow: hidden;
}

.stats__item {
  display: flex;
  flex-direction: column;
}

.stats__value {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.stats__label {
  font-size: 12px;
  color: #b8b2a2;
}

.stats__sep {
  width: 1px;
  height: 30px;
  background: rgba(251, 247, 238, 0.16);
}

.stats__car {
  margin-left: auto;
  color: #8fd1ab;
}

.stats__car svg {
  width: 46px;
  height: 24px;
  animation: drive 1.8s ease-in-out infinite;
}

.cta {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 60px;
  border: none;
  border-radius: 20px;
  background: #2f7d57;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 18px 40px rgba(47, 125, 87, 0.38);
  animation: rise 0.7s 0.45s var(--ease-out) backwards;
  transition:
    background-color 0.25s ease,
    box-shadow 0.25s ease,
    color 0.25s ease,
    transform 0.2s var(--ease-out);
}

.cta:hover:not(:disabled) {
  background: #266a49;
  box-shadow: 0 22px 48px rgba(47, 125, 87, 0.45);
  transform: translateY(-2px);
}

.cta:active:not(:disabled) {
  transform: scale(0.98);
}

.cta:disabled {
  background: var(--glass);
  color: #8a8578;
  border: 1px solid var(--line);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.1);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  cursor: default;
}

.cta svg {
  position: relative;
  width: 20px;
  height: 20px;
  transition: transform 0.2s ease;
}

.cta:hover:not(:disabled) svg {
  transform: translateX(4px);
}

.cta:disabled svg {
  opacity: 0.5;
}

.cta__text {
  position: relative;
}

.cta__shine {
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  transform: translateX(-160%) skewX(-20deg);
  animation: shine 3.2s 1.2s ease-in-out infinite;
  pointer-events: none;
}

.cta:disabled .cta__shine {
  display: none;
}

.picking {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 10px 0 18px;
  border-radius: 20px;
  background: #2b2b26;
  color: #fbf7ee;
  font-size: 14.5px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
}

.picking__pulse {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8fd1ab;
  animation: live-light 1.6s infinite;
}

.picking__text {
  flex: 1;
}

.picking__text strong {
  color: #8fd1ab;
}

.picking__cancel {
  flex-shrink: 0;
  padding: 10px 14px;
  border: none;
  border-radius: 13px;
  background: rgba(251, 247, 238, 0.12);
  color: #fbf7ee;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.picking__cancel:hover {
  background: rgba(251, 247, 238, 0.2);
}

.controls {
  position: absolute;
  right: 20px;
  bottom: 32px;
  z-index: 900;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.5s var(--ease-out);
  animation: rise 0.7s 0.45s var(--ease-out) backwards;
}

.controls--shifted {
  transform: translateX(-440px);
}

.controls__group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--glass);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.14);
  overflow: hidden;
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
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.ctrl:hover {
  background: #f1ebdd;
}

.ctrl:active {
  transform: scale(0.92);
}

.ctrl svg {
  width: 22px;
  height: 22px;
}

.ctrl--locate {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--glass);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.14);
}

.ctrl--on,
.ctrl--following {
  color: #2f7d57;
}

.ctrl--following {
  background: #e3efe7;
}

.ctrl--off {
  color: #b5ae9f;
}

.ctrl__spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid #e3efe7;
  border-top-color: #2f7d57;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.toast {
  position: absolute;
  left: 50%;
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

.dock-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.55s var(--ease-out);
}

.dock-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.25s ease;
}

.dock-enter-from,
.dock-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

.swap-enter-active,
.swap-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.25s var(--ease-out);
}

.swap-enter-from,
.swap-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.stats-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.45s var(--ease-out);
}

.stats-leave-active {
  transition: opacity 0.15s ease;
}

.stats-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.stats-leave-to {
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

@keyframes chip-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
}

@keyframes live {
  0% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.5);
  }
  70%,
  100% {
    box-shadow: 0 0 0 7px rgba(47, 125, 87, 0);
  }
}

@keyframes live-light {
  0% {
    box-shadow: 0 0 0 0 rgba(143, 209, 171, 0.6);
  }
  70%,
  100% {
    box-shadow: 0 0 0 9px rgba(143, 209, 171, 0);
  }
}

@keyframes pick-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.45);
  }
  70%,
  100% {
    box-shadow: 0 0 0 8px rgba(47, 125, 87, 0);
  }
}

@keyframes shine {
  0%,
  60% {
    transform: translateX(-160%) skewX(-20deg);
  }
  100% {
    transform: translateX(320%) skewX(-20deg);
  }
}

@keyframes drive {
  0%,
  100% {
    transform: translateX(-3px);
  }
  50% {
    transform: translateX(3px);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
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
    font-size: 18px;
  }

  .topbar__city {
    padding: 7px 10px;
    font-size: 12.5px;
  }

  .topbar__logout {
    padding: 9px;
  }

  .topbar__logout span {
    display: none;
  }

  .dock {
    top: calc(76px + env(safe-area-inset-top));
    left: 10px;
    right: 10px;
    bottom: calc(14px + env(safe-area-inset-bottom));
    justify-content: space-between;
    width: auto;
  }

  .panel {
    padding: 14px 12px 12px;
    border-radius: 22px;
    transition:
      opacity 0.25s ease,
      transform 0.35s var(--ease-out);
  }

  .page--picking .panel {
    opacity: 0;
    transform: translateY(-16px);
    pointer-events: none;
  }

  .panel__eyebrow {
    display: none;
  }

  .panel__title {
    margin-bottom: 10px;
    font-size: 20px;
  }

  .route {
    grid-template-columns: minmax(0, 1fr) 40px;
    gap: 8px 6px;
  }

  .pick {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .route__swap {
    right: 56px;
  }

  .note {
    margin-top: 8px;
    padding: 8px 8px 8px 10px;
    font-size: 12.5px;
  }

  .quick {
    margin: 10px -12px 0;
  }

  .quick__title {
    display: none;
  }

  .quick__list {
    flex-wrap: nowrap;
    padding: 0 12px 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .quick__list::-webkit-scrollbar {
    display: none;
  }

  .stats {
    margin-top: 10px;
    padding: 10px 14px;
    border-radius: 16px;
  }

  .stats__value {
    font-size: 16px;
  }

  .cta,
  .picking {
    height: 56px;
    border-radius: 18px;
  }

  .picking {
    font-size: 13.5px;
  }

  .controls {
    right: 12px;
    bottom: calc(84px + env(safe-area-inset-bottom));
  }

  .controls--shifted,
  .page--ride .controls {
    transform: none;
    opacity: 0;
    pointer-events: none;
  }

  .ride-dock {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-height: 72dvh;
  }

  .ctrl {
    width: 44px;
    height: 44px;
  }

  .toast {
    top: calc(76px + env(safe-area-inset-top));
    bottom: auto;
  }

  .dock-enter-from,
  .dock-leave-to {
    transform: translateY(-12px);
  }
}

@media (hover: none) {
  .ctrl:hover {
    background: transparent;
  }

  .ctrl--following:hover {
    background: #e3efe7;
  }

  .cta:hover:not(:disabled) {
    background: #2f7d57;
    transform: none;
  }

  .pick:hover,
  .quick__chip:hover {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map,
  .topbar,
  .panel,
  .cta,
  .controls,
  .quick__chip {
    animation: none;
    transition: none;
    opacity: 1;
    transform: none;
  }

  .cta__shine {
    display: none;
  }
}
</style>

