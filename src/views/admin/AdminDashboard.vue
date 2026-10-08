<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import L from 'leaflet'
import StageBadge from '@/components/admin/StageBadge.vue'
import { adminApi } from '@/api/admin'
import { RouteLayer, createCityMap, icons } from '@/utils/map'
import { personName } from '@/utils/admin'
import { formatFare, fullName, initials, isFinal, timeAgo } from '@/utils/order'
import type { AdminClient, AdminDriver } from '@/types/admin'
import type { OrderStage, OrderView, TripView } from '@/types/order'

const REFRESH_MS = 10_000

const router = useRouter()
const orders = ref<OrderView[]>([])
const trips = ref<TripView[]>([])
const clients = ref<AdminClient[]>([])
const drivers = ref<AdminDriver[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const hoverHour = ref<number | null>(null)
const mapEl = ref<HTMLElement | null>(null)

let map: L.Map | null = null
const layers: L.Layer[] = []
const routes: RouteLayer[] = []
let timer = 0
let fittedOnce = false

const startOfDay = () => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const live = computed(() => orders.value.filter((order) => !isFinal(order.stage)))
const todayOrders = computed(() => orders.value.filter((order) => order.createdAt && Date.parse(order.createdAt) >= startOfDay()))
const revenueToday = computed(() =>
  trips.value.filter((trip) => trip.endedAt && Date.parse(trip.endedAt) >= startOfDay()).reduce((sum, trip) => sum + (trip.fare ?? 0), 0),
)
const avgFare = computed(() => {
  const paid = trips.value.filter((trip) => trip.fare !== null)
  return paid.length ? paid.reduce((sum, trip) => sum + (trip.fare ?? 0), 0) / paid.length : null
})
const activeDrivers = computed(() => drivers.value.filter((driver) => !driver.blocked))
const avgRating = computed(() => {
  const rated = activeDrivers.value.filter((driver) => driver.rating)
  return rated.length ? rated.reduce((sum, driver) => sum + (driver.rating ?? 0), 0) / rated.length : null
})

const STAGES: { stage: OrderStage; label: string }[] = [
  { stage: 'searching', label: 'Пошук водія' },
  { stage: 'accepted', label: 'Водій їде' },
  { stage: 'arrived', label: 'Водій на місці' },
  { stage: 'started', label: 'У дорозі' },
  { stage: 'completed', label: 'Завершено' },
  { stage: 'cancelled', label: 'Скасовано' },
]

const breakdown = computed(() => {
  const total = Math.max(1, orders.value.length)
  return STAGES.map((item) => {
    const count = orders.value.filter((order) => order.stage === item.stage).length
    return { ...item, count, share: count / total }
  })
})
const breakdownMax = computed(() => Math.max(1, ...breakdown.value.map((item) => item.count)))

const hours = computed(() => {
  const buckets = Array.from({ length: 24 }, () => 0)
  for (const order of todayOrders.value) buckets[new Date(order.createdAt!).getHours()]!++
  return buckets
})
const hoursMax = computed(() => Math.max(1, ...hours.value))
const nowHour = new Date().getHours()

const recent = computed(() => orders.value.slice(0, 6))
const topDrivers = computed(() =>
  [...activeDrivers.value].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.ratingCount - a.ratingCount).slice(0, 4),
)

const clientById = computed(() => new Map(clients.value.map((client) => [client.id, client])))
const orderClient = (order: OrderView) => {
  if (order.client) return fullName(order.client)
  const client = order.clientId ? clientById.value.get(order.clientId) : undefined
  return client ? personName(client, 'Клієнт') : order.clientId ? `Клієнт №${order.clientId}` : 'Клієнт'
}

async function load() {
  clearTimeout(timer)
  try {
    const [o, t, c, d] = await Promise.all([adminApi.orders(1, 50), adminApi.trips(1, 50), adminApi.clients(), adminApi.drivers()])
    orders.value = o.data
    trips.value = t.data
    clients.value = c
    drivers.value = d
    state.value = 'ready'
  } catch {
    if (state.value !== 'ready') state.value = 'error'
  }
  timer = window.setTimeout(load, REFRESH_MS)
}

function drawMap() {
  if (!map) return
  layers.splice(0).forEach((layer) => layer.remove())
  routes.splice(0).forEach((route) => route.clear())
  const points: L.LatLngExpression[] = []
  for (const order of live.value) {
    const route = new RouteLayer(map)
    route.draw(order.pickup, order.destination)
    routes.push(route)
    layers.push(
      L.marker([order.pickup.lat, order.pickup.lng], { icon: icons.pickup, title: `№${order.id}` })
        .addTo(map)
        .on('click', () => openOrder(order.id)),
      L.marker([order.destination.lat, order.destination.lng], { icon: icons.destination, title: order.destination.address }).addTo(map),
    )
    points.push([order.pickup.lat, order.pickup.lng], [order.destination.lat, order.destination.lng])
  }
  if (points.length && !fittedOnce) {
    fittedOnce = true
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
  }
}

function openOrder(id: number) {
  router.push({ name: 'admin-orders', query: { id: String(id) } })
}

watch(live, drawMap)

onMounted(() => {
  load()
  if (mapEl.value) {
    map = createCityMap(mapEl.value)
    map.setZoom(12.5)
  }
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  map?.remove()
  map = null
})
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Огляд</h1>
        <p class="a-sub">Усе, що відбувається в UhilTaxi просто зараз</p>
      </div>
      <span class="a-badge a-badge--green a-badge--live">Оновлюється наживо</span>
    </header>

    <p v-if="state === 'error'" class="a-alert">Не вдалося завантажити дані. Перевірте з'єднання з сервером</p>

    <section class="kpis">
      <article class="a-card kpi kpi--hero">
        <span class="kpi__label">Активні поїздки</span>
        <span v-if="state === 'loading'" class="a-skeleton kpi__skel"></span>
        <span v-else class="kpi__value">{{ live.length }}</span>
        <span class="kpi__hint">
          {{ live.filter((order) => order.stage === 'searching').length }} чекають на водія
        </span>
      </article>
      <article class="a-card kpi">
        <span class="kpi__label">Замовлень сьогодні</span>
        <span v-if="state === 'loading'" class="a-skeleton kpi__skel"></span>
        <span v-else class="kpi__value">{{ todayOrders.length }}</span>
        <span class="kpi__hint">{{ todayOrders.filter((order) => order.stage === 'cancelled').length }} скасовано</span>
      </article>
      <article class="a-card kpi">
        <span class="kpi__label">Виручка сьогодні</span>
        <span v-if="state === 'loading'" class="a-skeleton kpi__skel"></span>
        <span v-else class="kpi__value">{{ formatFare(revenueToday) }}</span>
        <span class="kpi__hint">середній чек {{ formatFare(avgFare) }}</span>
      </article>
      <article class="a-card kpi">
        <span class="kpi__label">Водії</span>
        <span v-if="state === 'loading'" class="a-skeleton kpi__skel"></span>
        <span v-else class="kpi__value">{{ activeDrivers.length }}</span>
        <span class="kpi__hint">рейтинг {{ avgRating ? avgRating.toFixed(2).replace('.', ',') : '—' }} ★</span>
      </article>
      <article class="a-card kpi">
        <span class="kpi__label">Клієнти</span>
        <span v-if="state === 'loading'" class="a-skeleton kpi__skel"></span>
        <span v-else class="kpi__value">{{ clients.length }}</span>
        <span class="kpi__hint">{{ clients.filter((client) => client.blocked).length }} заблоковано</span>
      </article>
    </section>

    <section class="row">
      <article class="a-card map-card">
        <header class="map-card__head">
          <h2 class="a-card__title">Карта активних замовлень</h2>
          <span class="a-muted">{{ live.length }} на карті</span>
        </header>
        <div ref="mapEl" class="map-card__map"></div>
      </article>

      <article class="a-card a-card--pad">
        <h2 class="a-card__title">Статуси замовлень</h2>
        <ul class="bars">
          <li v-for="item in breakdown" :key="item.stage" class="bars__row">
            <span class="bars__label">{{ item.label }}</span>
            <span class="bars__track">
              <span class="bars__fill" :style="{ width: `${(item.count / breakdownMax) * 100}%` }"></span>
            </span>
            <span class="bars__value">{{ item.count }}</span>
          </li>
        </ul>
        <p class="a-muted bars__note">За останніми {{ orders.length }} замовленнями</p>
      </article>
    </section>

    <section class="row row--even">
      <article class="a-card a-card--pad">
        <header class="hours__head">
          <h2 class="a-card__title">Замовлення по годинах, сьогодні</h2>
          <span class="hours__readout" aria-live="polite">
            <template v-if="hoverHour !== null">
              {{ String(hoverHour).padStart(2, '0') }}:00 — <strong>{{ hours[hoverHour] }}</strong>
            </template>
            <template v-else>Всього <strong>{{ todayOrders.length }}</strong></template>
          </span>
        </header>
        <div class="hours" role="img" :aria-label="`Замовлень сьогодні: ${todayOrders.length}`" @mouseleave="hoverHour = null">
          <span
            v-for="(count, hour) in hours"
            :key="hour"
            class="hours__col"
            :class="{ 'hours__col--now': hour === nowHour, 'hours__col--hover': hoverHour === hour }"
            @mouseenter="hoverHour = hour"
          >
            <span class="hours__bar" :style="{ height: `${Math.max(count ? 8 : 2, (count / hoursMax) * 100)}%` }"></span>
          </span>
        </div>
        <div class="hours__axis" aria-hidden="true">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
      </article>

      <article class="a-card a-card--pad">
        <header class="hours__head">
          <h2 class="a-card__title">Найкращі водії</h2>
          <RouterLink :to="{ name: 'admin-drivers' }" class="link">Усі водії →</RouterLink>
        </header>
        <ul class="people">
          <li v-for="(driver, index) in topDrivers" :key="driver.id" class="people__row">
            <span class="people__rank">{{ index + 1 }}</span>
            <span class="a-avatar a-avatar--dark">{{ (driver.firstName.charAt(0) + driver.lastName.charAt(0)).toUpperCase() }}</span>
            <span class="people__who">
              <span class="a-person__name">{{ personName(driver, 'Водій') }}</span>
              <span class="a-person__meta">{{ driver.ratingCount }} поїздок</span>
            </span>
            <span class="people__rating">★ {{ driver.rating ? driver.rating.toFixed(2).replace('.', ',') : '—' }}</span>
          </li>
          <li v-if="state === 'ready' && !topDrivers.length" class="a-muted">Водіїв ще немає</li>
        </ul>
      </article>
    </section>

    <article class="a-card">
      <header class="recent__head">
        <h2 class="a-card__title">Останні замовлення</h2>
        <RouterLink :to="{ name: 'admin-orders' }" class="link">Усі замовлення →</RouterLink>
      </header>
      <div class="a-table-wrap">
        <table class="a-table">
          <tbody>
            <tr v-for="order in recent" :key="order.id" @click="openOrder(order.id)">
              <td class="a-strong">№{{ order.id }}</td>
              <td>
                <span class="a-person">
                  <span class="a-avatar">{{ initials(order.client, orderClient(order).charAt(0)) }}</span>
                  <span class="a-person__name">{{ orderClient(order) }}</span>
                </span>
              </td>
              <td class="a-hide-sm"><span class="a-ellipsis">{{ order.pickup.address }} → {{ order.destination.address }}</span></td>
              <td><StageBadge :stage="order.stage" /></td>
              <td class="a-num a-strong">{{ formatFare(order.fare) }}</td>
              <td class="a-num a-muted a-hide-sm">{{ timeAgo(order.createdAt) }}</td>
            </tr>
            <tr v-if="state === 'ready' && !recent.length">
              <td colspan="6" class="a-muted">Замовлень ще немає</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: 1.3fr repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
}

.a-card.kpi--hero {
  border-color: transparent;
  background: linear-gradient(135deg, #2f7d57, #23603f);
  color: #fbf7ee;
  box-shadow: 0 18px 40px rgba(47, 125, 87, 0.3);
}

.kpi__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.kpi--hero .kpi__label,
.kpi--hero .kpi__hint {
  color: rgba(251, 247, 238, 0.75);
}

.kpi__value {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.kpi--hero .kpi__value {
  color: #fbf7ee;
}

.kpi__skel {
  width: 70%;
  height: 40px;
  margin: 2px 0;
}

.kpi__hint {
  font-size: 12.5px;
  color: var(--muted);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: 14px;
}

.row--even {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
}

.map-card {
  overflow: hidden;
}

.map-card__head,
.recent__head,
.hours__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.map-card__head {
  padding: 18px 20px 0;
}

.recent__head {
  padding: 18px 20px 4px;
}

.map-card__map {
  height: 340px;
  margin: 0 12px 12px;
  border-radius: 16px;
  overflow: hidden;
}

.bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bars__row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
}

.bars__label {
  color: var(--ink-2);
}

.bars__track {
  height: 10px;
  border-radius: 999px;
  background: #f1ebdd;
  overflow: hidden;
}

.bars__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--green);
  transition: width 0.6s var(--ease-out);
}

.bars__value {
  font-weight: 700;
  color: var(--ink);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.bars__note {
  margin: 16px 0 0;
  font-size: 12.5px;
}

.hours__readout {
  font-size: 13px;
  color: var(--muted);
}

.hours__readout strong {
  color: var(--ink);
}

.hours {
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 2px;
  align-items: end;
  height: 150px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--line);
}

.hours__col {
  display: flex;
  align-items: flex-end;
  height: 100%;
  cursor: default;
}

.hours__bar {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: #b9d8c6;
  transition:
    height 0.6s var(--ease-out),
    background-color 0.15s ease;
}

.hours__col--now .hours__bar {
  background: var(--green);
}

.hours__col--hover .hours__bar {
  background: var(--ink);
}

.hours__axis {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.people {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.people__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.people__rank {
  width: 18px;
  font-size: 13px;
  font-weight: 700;
  color: var(--faint);
  text-align: center;
}

.people__who {
  flex: 1;
  min-width: 0;
}

.people__rating {
  font-weight: 700;
  color: var(--ink);
}

.link {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--green);
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}

@media (max-width: 1200px) {
  .kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .kpi--hero {
    grid-column: span 3;
  }
}

@media (max-width: 960px) {
  .row,
  .row--even {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kpi--hero {
    grid-column: span 2;
  }

  .kpi__value {
    font-size: 26px;
  }

  .map-card__map {
    height: 260px;
  }
}
</style>
