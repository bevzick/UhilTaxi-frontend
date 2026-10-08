<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AddressInput from '@/components/AddressInput.vue'
import AdminDrawer from '@/components/admin/AdminDrawer.vue'
import RouteMiniMap from '@/components/admin/RouteMiniMap.vue'
import StageBadge from '@/components/admin/StageBadge.vue'
import { adminApi } from '@/api/admin'
import { normalizePromo, prepareOrder, validatePromo } from '@/api/orders'
import { useAdminUi } from '@/composables/useAdminUi'
import { formatDateTime, personName } from '@/utils/admin'
import { STAGE_LABEL, formatFare, formatKm, fullName, initials, isFinal, toStage, timeAgo } from '@/utils/order'
import type { AdminClient, AdminDriver, AdminTariff, HistoryEntry } from '@/types/admin'
import type { Estimate, OrderStage, OrderView } from '@/types/order'
import type { Place } from '@/types/geo'

const REFRESH_MS = 10_000
const LIMIT = 50

const route = useRoute()
const router = useRouter()
const { notify, confirm, failMessage } = useAdminUi()

const orders = ref<OrderView[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const query = ref('')
const stageFilter = ref<OrderStage | 'all' | 'live'>('all')
const clients = ref<AdminClient[]>([])
const drivers = ref<AdminDriver[]>([])
const tariffs = ref<AdminTariff[]>([])

const openId = ref<number | null>(null)
const detail = ref<OrderView | null>(null)
const history = ref<HistoryEntry[]>([])
const historyState = ref<'loading' | 'ready' | 'error'>('loading')
const assignTo = ref<number | null>(null)
const busy = ref('')

const createOpen = ref(false)
const form = ref({ clientId: null as number | null, clientQuery: '', pickup: null as Place | null, destination: null as Place | null, tariffId: null as number | null, promo: '' })
const estimate = ref<Estimate | null>(null)
const estimateError = ref('')
const createError = ref('')
const creating = ref(false)

let timer = 0
let estimateTimer = 0

const FILTERS: { id: OrderStage | 'all' | 'live'; label: string }[] = [
  { id: 'all', label: 'Усі' },
  { id: 'live', label: 'Активні' },
  { id: 'searching', label: 'Пошук' },
  { id: 'accepted', label: 'Водій їде' },
  { id: 'arrived', label: 'На місці' },
  { id: 'started', label: 'У дорозі' },
  { id: 'completed', label: 'Завершені' },
  { id: 'cancelled', label: 'Скасовані' },
]

const matchesStage = (order: OrderView, filter: OrderStage | 'all' | 'live') =>
  filter === 'all' || (filter === 'live' ? !isFinal(order.stage) : order.stage === filter)

const counts = computed(() =>
  Object.fromEntries(FILTERS.map((item) => [item.id, orders.value.filter((order) => matchesStage(order, item.id)).length])),
)

const clientById = computed(() => new Map(clients.value.map((client) => [client.id, client])))
const driverById = computed(() => new Map(drivers.value.map((driver) => [driver.id, driver])))
const tariffById = computed(() => new Map(tariffs.value.map((tariff) => [tariff.id, tariff])))
const availableDrivers = computed(() => drivers.value.filter((driver) => !driver.blocked))

function clientName(order: OrderView) {
  if (order.client) return fullName(order.client)
  const client = order.clientId ? clientById.value.get(order.clientId) : undefined
  return client ? personName(client, 'Клієнт') : order.clientId ? `Клієнт №${order.clientId}` : '—'
}

function driverName(order: OrderView) {
  if (order.driver) return fullName(order.driver)
  const driver = order.driverId ? driverById.value.get(order.driverId) : undefined
  return driver ? personName(driver, 'Водій') : order.driverId ? `Водій №${order.driverId}` : ''
}

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return orders.value.filter((order) => {
    if (!matchesStage(order, stageFilter.value)) return false
    if (!q) return true
    return [String(order.id), order.pickup.address, order.destination.address, clientName(order), driverName(order)]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
})

async function loadList() {
  clearTimeout(timer)
  try {
    const result = await adminApi.orders(page.value, LIMIT)
    orders.value = result.data
    pages.value = result.pages
    total.value = result.total
    state.value = 'ready'
    if (detail.value) {
      const fresh = result.data.find((order) => order.id === detail.value!.id)
      if (fresh && fresh.status !== detail.value.status) refreshDetail()
    }
  } catch {
    if (state.value !== 'ready') state.value = 'error'
  }
  timer = window.setTimeout(loadList, REFRESH_MS)
}

async function loadRefs() {
  const [c, d, t] = await Promise.allSettled([adminApi.clients(), adminApi.drivers(), adminApi.tariffs()])
  if (c.status === 'fulfilled') clients.value = c.value
  if (d.status === 'fulfilled') drivers.value = d.value
  if (t.status === 'fulfilled') tariffs.value = t.value
}

function goPage(next: number) {
  page.value = Math.min(Math.max(1, next), pages.value)
  state.value = 'loading'
  loadList()
}

function open(id: number) {
  router.replace({ query: { ...route.query, id: String(id) } })
}

function close() {
  const { id: _id, ...rest } = route.query
  void _id
  router.replace({ query: rest })
}

async function refreshDetail() {
  if (openId.value === null) return
  try {
    detail.value = await adminApi.order(openId.value)
  } catch (e) {
    notify(failMessage(e, 'Не вдалося завантажити замовлення'), 'error')
  }
  historyState.value = 'loading'
  try {
    history.value = await adminApi.history(openId.value)
    historyState.value = 'ready'
  } catch {
    historyState.value = 'error'
  }
}

watch(
  () => route.query.id,
  (raw) => {
    const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null
    openId.value = id
    assignTo.value = null
    if (id === null) {
      detail.value = null
      return
    }
    detail.value = orders.value.find((order) => order.id === id) ?? null
    history.value = []
    refreshDetail()
  },
  { immediate: true },
)

async function act(key: string, action: () => Promise<unknown>, success: string) {
  if (busy.value) return
  busy.value = key
  try {
    await action()
    notify(success)
    await refreshDetail()
    loadList()
  } catch (e) {
    notify(failMessage(e), 'error')
  } finally {
    busy.value = ''
  }
}

const assign = () => {
  const order = detail.value
  const driverId = assignTo.value
  if (!order || driverId === null) return
  const name = personName(driverById.value.get(driverId) ?? { id: driverId, firstName: '', lastName: '' }, 'Водій')
  return act('assign', () => adminApi.assignDriver(order.id, driverId), `Призначено: ${name}`)
}

const arrived = () => detail.value && act('arrived', () => adminApi.markArrived(detail.value!.id), 'Позначено: водій на місці')
const start = () => detail.value && act('start', () => adminApi.startTrip(detail.value!.id), 'Поїздку розпочато')
const complete = () =>
  detail.value && act('complete', () => adminApi.completeTrip(detail.value!.id, detail.value!.distanceKm), 'Поїздку завершено')

async function cancel() {
  const order = detail.value
  if (!order) return
  const reason = await confirm({
    title: `Скасувати замовлення №${order.id}?`,
    text: 'Клієнт і водій побачать, що замовлення скасовано адміністратором.',
    action: 'Скасувати замовлення',
    danger: true,
    input: { label: 'Причина', placeholder: 'Наприклад: дубль замовлення', value: 'Скасовано адміністратором' },
  })
  if (reason === false) return
  await act('cancel', () => adminApi.cancelOrder(order.id, reason || null), `Замовлення №${order.id} скасовано`)
}

// Create order on behalf of a client

const clientMatches = computed(() => {
  const q = form.value.clientQuery.trim().toLowerCase()
  const list = clients.value.filter((client) => !client.blocked)
  if (!q) return list.slice(0, 6)
  return list.filter((client) => `${personName(client)} ${client.phone} ${client.email}`.toLowerCase().includes(q)).slice(0, 6)
})
const pickedClient = computed(() => (form.value.clientId ? clientById.value.get(form.value.clientId) ?? null : null))
const activeTariffs = computed(() => tariffs.value.filter((tariff) => tariff.active))

function openCreate() {
  form.value = { clientId: null, clientQuery: '', pickup: null, destination: null, tariffId: activeTariffs.value[0]?.id ?? null, promo: '' }
  estimate.value = null
  estimateError.value = ''
  createError.value = ''
  createOpen.value = true
}

function draft() {
  return prepareOrder({ pickup: form.value.pickup, destination: form.value.destination, tariffId: form.value.tariffId, promocode: form.value.promo })
}

watch(
  () => [form.value.pickup, form.value.destination, form.value.tariffId, form.value.promo],
  () => {
    clearTimeout(estimateTimer)
    estimate.value = null
    estimateError.value = ''
    const prepared = draft()
    if (!('data' in prepared)) return
    estimateTimer = window.setTimeout(async () => {
      try {
        estimate.value = await adminApi.estimate(prepared.data)
      } catch (e) {
        estimateError.value = failMessage(e, 'Не вдалося розрахувати вартість')
      }
    }, 450)
  },
)

async function create() {
  createError.value = ''
  if (!form.value.clientId) {
    createError.value = 'Оберіть клієнта'
    return
  }
  const promoError = validatePromo(form.value.promo)
  if (promoError) {
    createError.value = promoError
    return
  }
  const prepared = draft()
  if ('error' in prepared) {
    createError.value = prepared.error
    return
  }
  creating.value = true
  try {
    const order = await adminApi.createOrder(form.value.clientId, { ...prepared.data, promocode: normalizePromo(form.value.promo) || null })
    notify(`Замовлення №${order.id} створено`)
    createOpen.value = false
    await loadList()
    open(order.id)
  } catch (e) {
    createError.value = failMessage(e, 'Не вдалося створити замовлення')
  } finally {
    creating.value = false
  }
}

const STEP_LABEL = (status: string) => (status ? STAGE_LABEL[toStage(status)] : 'Створено')

onMounted(() => {
  loadList()
  loadRefs()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(estimateTimer)
})
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Замовлення</h1>
        <p class="a-sub">{{ total }} замовлень · оновлюється кожні 10 секунд</p>
      </div>
      <button type="button" class="a-btn a-btn--primary" @click="openCreate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Нове замовлення
      </button>
    </header>

    <div class="a-toolbar">
      <label class="a-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input v-model="query" class="a-input" type="search" placeholder="№, адреса, клієнт або водій" aria-label="Пошук замовлень" />
      </label>
      <div class="a-chips" role="tablist" aria-label="Фільтр за статусом">
        <button
          v-for="item in FILTERS"
          :key="item.id"
          type="button"
          role="tab"
          class="a-chip"
          :class="{ 'a-chip--active': stageFilter === item.id }"
          :aria-selected="stageFilter === item.id"
          @click="stageFilter = item.id"
        >
          {{ item.label }}
          <span class="a-chip__count">{{ counts[item.id] }}</span>
        </button>
      </div>
    </div>

    <article class="a-card">
      <div class="a-table-wrap">
        <table class="a-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Клієнт</th>
              <th class="a-hide-sm">Маршрут</th>
              <th class="a-hide-sm">Водій</th>
              <th>Статус</th>
              <th class="a-num">Ціна</th>
              <th class="a-num a-hide-sm">Створено</th>
            </tr>
          </thead>
          <tbody v-if="state === 'loading'">
            <tr v-for="n in 6" :key="n">
              <td colspan="7"><span class="a-skeleton" style="height: 22px"></span></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="order in visible" :key="order.id" :class="{ 'row--open': order.id === openId }" @click="open(order.id)">
              <td class="a-strong">№{{ order.id }}</td>
              <td>
                <span class="a-person">
                  <span class="a-avatar">{{ initials(order.client, clientName(order).charAt(0)) }}</span>
                  <span class="a-person__name">{{ clientName(order) }}</span>
                </span>
              </td>
              <td class="a-hide-sm">
                <span class="route">
                  <span class="route__from a-ellipsis">{{ order.pickup.address }}</span>
                  <span class="route__to a-ellipsis">{{ order.destination.address }}</span>
                </span>
              </td>
              <td class="a-hide-sm">
                <span v-if="driverName(order)">{{ driverName(order) }}</span>
                <span v-else class="a-muted">—</span>
              </td>
              <td><StageBadge :stage="order.stage" /></td>
              <td class="a-num a-strong">{{ formatFare(order.fare) }}</td>
              <td class="a-num a-muted a-hide-sm">{{ timeAgo(order.createdAt) }}</td>
            </tr>
            <tr v-if="!visible.length">
              <td colspan="7">
                <div class="a-empty">
                  <strong>{{ state === 'error' ? 'Не вдалося завантажити' : 'Нічого не знайдено' }}</strong>
                  <span>{{ state === 'error' ? 'Перевірте з’єднання з сервером' : 'Спробуйте інший фільтр або запит' }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="pages > 1" class="a-pager">
        <span>Сторінка {{ page }} з {{ pages }}</span>
        <span class="a-pager__btns">
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" :disabled="page <= 1" @click="goPage(page - 1)">← Назад</button>
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" :disabled="page >= pages" @click="goPage(page + 1)">Далі →</button>
        </span>
      </footer>
    </article>

    <!-- Order details -->
    <AdminDrawer :open="openId !== null" wide :title="`Замовлення №${openId ?? ''}`" :subtitle="detail ? `Створено ${formatDateTime(detail.createdAt)}` : ''" @close="close">
      <template v-if="detail">
        <div class="detail__status">
          <StageBadge :stage="detail.stage" />
          <span class="a-muted">статус API: {{ detail.status }}</span>
        </div>

        <RouteMiniMap :from="detail.pickup" :to="detail.destination" />

        <div class="trip">
          <p class="trip__point trip__point--from">{{ detail.pickup.address }}</p>
          <p class="trip__point trip__point--to">{{ detail.destination.address }}</p>
        </div>

        <dl class="a-dl">
          <dt>Клієнт</dt>
          <dd>{{ clientName(detail) }}</dd>
          <dt>Водій</dt>
          <dd>{{ driverName(detail) || 'Не призначено' }}</dd>
          <dt>Тариф</dt>
          <dd>{{ detail.tariffId ? tariffById.get(detail.tariffId)?.name ?? `№${detail.tariffId}` : '—' }}</dd>
          <dt>Відстань / час</dt>
          <dd>{{ formatKm(detail.distanceKm) }} · {{ detail.durationMin ?? '—' }} хв</dd>
          <dt>Вартість</dt>
          <dd class="detail__fare">{{ formatFare(detail.fare) }}</dd>
          <template v-if="detail.cancellationReason">
            <dt>Причина скасування</dt>
            <dd>{{ detail.cancellationReason }}</dd>
          </template>
        </dl>

        <section v-if="!isFinal(detail.stage)" class="actions">
          <h3 class="actions__title">Керування</h3>

          <div v-if="detail.stage === 'searching' || detail.stage === 'accepted'" class="assign">
            <select v-model="assignTo" class="a-select" aria-label="Водій для призначення">
              <option :value="null" disabled>{{ detail.stage === 'accepted' ? 'Змінити водія…' : 'Оберіть водія…' }}</option>
              <option v-for="driver in availableDrivers" :key="driver.id" :value="driver.id" :disabled="driver.id === detail.driverId">
                {{ personName(driver, 'Водій') }} · ★ {{ driver.rating?.toFixed(1) ?? '—' }}
              </option>
            </select>
            <button type="button" class="a-btn a-btn--primary" :disabled="assignTo === null || !!busy" @click="assign">
              <span v-if="busy === 'assign'" class="a-spinner"></span>
              <template v-else>Призначити</template>
            </button>
          </div>

          <div class="actions__row">
            <button v-if="detail.stage === 'accepted'" type="button" class="a-btn a-btn--dark" :disabled="!!busy" @click="arrived">
              <span v-if="busy === 'arrived'" class="a-spinner"></span><template v-else>Водій на місці</template>
            </button>
            <button v-if="detail.stage === 'arrived'" type="button" class="a-btn a-btn--dark" :disabled="!!busy" @click="start">
              <span v-if="busy === 'start'" class="a-spinner"></span><template v-else>Почати поїздку</template>
            </button>
            <button v-if="detail.stage === 'started'" type="button" class="a-btn a-btn--dark" :disabled="!!busy" @click="complete">
              <span v-if="busy === 'complete'" class="a-spinner"></span><template v-else>Завершити поїздку</template>
            </button>
            <button type="button" class="a-btn a-btn--danger" :disabled="!!busy" @click="cancel">Скасувати замовлення</button>
          </div>
        </section>

        <section>
          <h3 class="actions__title">Історія статусів</h3>
          <p v-if="historyState === 'loading'" class="a-muted">Завантажуємо…</p>
          <p v-else-if="historyState === 'error'" class="a-muted">Історія недоступна</p>
          <ol v-else class="timeline">
            <li v-for="entry in history" :key="entry.id" class="timeline__item" :class="`timeline__item--${toStage(entry.toStatus)}`">
              <span class="timeline__dot"></span>
              <span class="timeline__body">
                <span class="timeline__title">{{ STEP_LABEL(entry.toStatus) }}</span>
                <span class="timeline__meta">
                  {{ formatDateTime(entry.at) }}
                  <template v-if="entry.changedBy"> · користувач №{{ entry.changedBy }}</template>
                </span>
                <span v-if="entry.reason" class="timeline__reason">«{{ entry.reason }}»</span>
              </span>
            </li>
            <li v-if="!history.length" class="a-muted">Записів ще немає</li>
          </ol>
        </section>
      </template>
      <div v-else class="a-empty"><span class="a-spinner a-spinner--dark"></span></div>
    </AdminDrawer>

    <!-- Create order -->
    <AdminDrawer :open="createOpen" wide title="Нове замовлення" subtitle="Оформлення поїздки від імені клієнта" @close="createOpen = false">
      <section class="a-field">
        <span class="a-label">Клієнт</span>
        <div v-if="pickedClient" class="picked">
          <span class="a-avatar a-avatar--dark">{{ (pickedClient.firstName.charAt(0) + pickedClient.lastName.charAt(0)).toUpperCase() || 'К' }}</span>
          <span class="picked__who">
            <span class="a-person__name">{{ personName(pickedClient, 'Клієнт') }}</span>
            <span class="a-person__meta">{{ pickedClient.phone }}</span>
          </span>
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" @click="form.clientId = null">Змінити</button>
        </div>
        <template v-else>
          <input v-model="form.clientQuery" class="a-input" type="search" placeholder="Ім'я, телефон або email" aria-label="Пошук клієнта" />
          <ul class="client-list">
            <li v-for="client in clientMatches" :key="client.id">
              <button type="button" class="client-list__item" @click="form.clientId = client.id">
                <span class="a-avatar">{{ (client.firstName.charAt(0) + client.lastName.charAt(0)).toUpperCase() || 'К' }}</span>
                <span class="picked__who">
                  <span class="a-person__name">{{ personName(client, 'Клієнт') }}</span>
                  <span class="a-person__meta">{{ client.phone }}</span>
                </span>
              </button>
            </li>
            <li v-if="!clientMatches.length" class="a-muted">Нікого не знайдено</li>
          </ul>
        </template>
      </section>

      <section class="create-route">
        <AddressInput v-model="form.pickup" input-id="adm-from" variant="from" label="Звідки" placeholder="Адреса посадки" />
        <AddressInput v-model="form.destination" input-id="adm-to" variant="to" label="Куди" placeholder="Пункт призначення" />
      </section>

      <div class="a-grid">
        <label class="a-field">
          <span class="a-label">Тариф</span>
          <select v-model="form.tariffId" class="a-select">
            <option v-for="tariff in activeTariffs" :key="tariff.id" :value="tariff.id">{{ tariff.name }}</option>
          </select>
        </label>
        <label class="a-field">
          <span class="a-label">Промокод</span>
          <input v-model="form.promo" class="a-input promo" maxlength="32" placeholder="Необов'язково" autocomplete="off" />
        </label>
      </div>

      <div class="quote" :class="{ 'quote--ready': estimate }">
        <template v-if="estimate">
          <span>
            <span class="quote__label">Вартість</span>
            <span class="quote__value">{{ formatFare(estimate.fare) }}</span>
          </span>
          <span class="quote__meta">
            {{ formatKm(estimate.distanceKm) }} · ≈ {{ estimate.durationMin }} хв
            <template v-if="estimate.discountAmount"> · знижка {{ formatFare(estimate.discountAmount) }}</template>
          </span>
        </template>
        <span v-else-if="estimateError" class="a-error">{{ estimateError }}</span>
        <span v-else class="a-muted">Вкажіть маршрут і тариф — порахуємо вартість</span>
      </div>

      <p v-if="createError" class="a-alert">{{ createError }}</p>

      <template #footer>
        <button type="button" class="a-btn a-btn--ghost" @click="createOpen = false">Скасувати</button>
        <button type="button" class="a-btn a-btn--primary" :disabled="creating" @click="create">
          <span v-if="creating" class="a-spinner"></span>
          <template v-else>Створити замовлення</template>
        </button>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.row--open td {
  background: #f4f0e4;
}

.route {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 14px;
  border-left: 2px dotted #cfc6b2;
}

.route__from {
  color: var(--ink);
}

.route__to {
  font-size: 13px;
  color: var(--muted);
}

.detail__status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

.detail__fare {
  font-size: 18px;
  color: var(--green) !important;
}

.trip {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 14px 36px;
  border-radius: 16px;
  background: #f4efe3;
}

.trip::before {
  content: '';
  position: absolute;
  top: 22px;
  bottom: 22px;
  left: 19px;
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 3px, transparent 3px 6px);
}

.trip__point {
  position: relative;
  margin: 0;
  font-size: 14.5px;
  font-weight: 500;
  color: var(--ink);
}

.trip__point::before {
  content: '';
  position: absolute;
  top: 4px;
  left: -23px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.trip__point--from::before {
  border: 3.5px solid var(--green);
  background: #ffffff;
}

.trip__point--to::before {
  border-radius: 3px;
  background: var(--ink);
  transform: rotate(45deg) scale(0.85);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1.5px dashed var(--line-strong);
  border-radius: 18px;
}

.actions__title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.actions .actions__title {
  margin: 0;
}

.assign {
  display: flex;
  gap: 8px;
}

.actions__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline__item {
  position: relative;
  display: flex;
  gap: 14px;
  padding-bottom: 16px;
}

.timeline__item:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: 0;
  left: 6px;
  width: 2px;
  background: var(--line);
}

.timeline__dot {
  position: relative;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 3px;
  border: 3px solid var(--surface);
  border-radius: 50%;
  background: var(--faint);
  box-shadow: 0 0 0 1.5px var(--line-strong);
}

.timeline__item--accepted .timeline__dot,
.timeline__item--arrived .timeline__dot {
  background: var(--blue);
}

.timeline__item--started .timeline__dot,
.timeline__item--completed .timeline__dot {
  background: var(--green);
}

.timeline__item--cancelled .timeline__dot {
  background: var(--red);
}

.timeline__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.timeline__meta {
  font-size: 12.5px;
  color: var(--muted);
}

.timeline__reason {
  font-size: 13px;
  font-style: italic;
  color: var(--ink-2);
}

.picked,
.client-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
}

.picked {
  border: 1.5px solid var(--green);
  background: #ffffff;
}

.picked__who {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.client-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.client-list__item {
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.client-list__item:hover {
  background: #f1ebdd;
}

.create-route {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.promo {
  text-transform: uppercase;
}

.quote {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 14px 18px;
  border-radius: 18px;
  background: #f4efe3;
  transition: background-color 0.3s ease;
}

.quote--ready {
  background: var(--ink);
  color: #fbf7ee;
}

.quote__label {
  display: block;
  font-size: 12px;
  color: #b8b2a2;
}

.quote__value {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.quote__meta {
  font-size: 13px;
  color: #d9d3c4;
  text-align: right;
}

@media (max-width: 720px) {
  .assign {
    flex-direction: column;
  }
}
</style>
