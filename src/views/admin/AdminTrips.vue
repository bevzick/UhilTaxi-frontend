<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminApi } from '@/api/admin'
import { formatDateTime } from '@/utils/admin'
import { formatFare, formatKm } from '@/utils/order'
import type { TripView } from '@/types/order'

const LIMIT = 50

const router = useRouter()
const trips = ref<TripView[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const state = ref<'loading' | 'ready' | 'error'>('loading')

const totals = computed(() => {
  const done = trips.value.filter((trip) => trip.fare !== null)
  const revenue = done.reduce((sum, trip) => sum + (trip.fare ?? 0), 0)
  const km = trips.value.reduce((sum, trip) => sum + (trip.distanceKm ?? 0), 0)
  return { revenue, km, avg: done.length ? revenue / done.length : null }
})

async function load() {
  state.value = 'loading'
  try {
    const result = await adminApi.trips(page.value, LIMIT)
    trips.value = result.data
    pages.value = result.pages
    total.value = result.total
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

function go(next: number) {
  page.value = Math.min(Math.max(1, next), pages.value)
  load()
}

onMounted(load)
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Поїздки</h1>
        <p class="a-sub">{{ total }} поїздок в історії</p>
      </div>
    </header>

    <section class="totals">
      <article class="a-card total">
        <span class="total__label">Виручка на сторінці</span>
        <span class="total__value">{{ formatFare(totals.revenue) }}</span>
      </article>
      <article class="a-card total">
        <span class="total__label">Середній чек</span>
        <span class="total__value">{{ formatFare(totals.avg) }}</span>
      </article>
      <article class="a-card total">
        <span class="total__label">Проїхано</span>
        <span class="total__value">{{ formatKm(totals.km) }}</span>
      </article>
    </section>

    <article class="a-card">
      <div class="a-table-wrap">
        <table class="a-table">
          <thead>
            <tr>
              <th>Поїздка</th>
              <th>Замовлення</th>
              <th class="a-hide-sm">Тариф</th>
              <th class="a-num">Відстань</th>
              <th class="a-num a-hide-sm">Час</th>
              <th class="a-num a-hide-sm">Завершено</th>
              <th class="a-num">Сума</th>
            </tr>
          </thead>
          <tbody v-if="state === 'loading'">
            <tr v-for="n in 6" :key="n"><td colspan="7"><span class="a-skeleton" style="height: 22px"></span></td></tr>
          </tbody>
          <tbody v-else>
            <tr
              v-for="trip in trips"
              :key="trip.id"
              @click="trip.orderId && router.push({ name: 'admin-orders', query: { id: String(trip.orderId) } })"
            >
              <td class="a-strong">#{{ trip.id }}</td>
              <td>{{ trip.orderId ? `№${trip.orderId}` : '—' }}</td>
              <td class="a-hide-sm">{{ trip.tariffName ?? '—' }}</td>
              <td class="a-num">{{ formatKm(trip.distanceKm) }}</td>
              <td class="a-num a-hide-sm">{{ trip.durationMin !== null ? `${trip.durationMin} хв` : '—' }}</td>
              <td class="a-num a-muted a-hide-sm">{{ trip.endedAt ? formatDateTime(trip.endedAt) : 'у дорозі' }}</td>
              <td class="a-num a-strong">{{ formatFare(trip.fare) }}</td>
            </tr>
            <tr v-if="!trips.length">
              <td colspan="7">
                <div class="a-empty">
                  <strong>{{ state === 'error' ? 'Не вдалося завантажити поїздки' : 'Поїздок ще немає' }}</strong>
                  <span v-if="state !== 'error'">Завершені поїздки з’являться тут</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="pages > 1" class="a-pager">
        <span>Сторінка {{ page }} з {{ pages }}</span>
        <span class="a-pager__btns">
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" :disabled="page <= 1" @click="go(page - 1)">← Назад</button>
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" :disabled="page >= pages" @click="go(page + 1)">Далі →</button>
        </span>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
}

.total__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.total__value {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ink);
}

@media (max-width: 720px) {
  .totals {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
