<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminDrawer from '@/components/admin/AdminDrawer.vue'
import DriverForm from '@/components/admin/DriverForm.vue'
import { adminApi } from '@/api/admin'
import { useAdminUi } from '@/composables/useAdminUi'
import { formatDate, personName } from '@/utils/admin'
import { isFinal } from '@/utils/order'
import type { AdminDriver, CreateDriverRequest, UpdateDriverRequest } from '@/types/admin'
import type { OrderView } from '@/types/order'

const { notify, confirm, failMessage } = useAdminUi()

const drivers = ref<AdminDriver[]>([])
const orders = ref<OrderView[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const query = ref('')
const filter = ref<'all' | 'busy' | 'blocked'>('all')
const sort = ref<'rating' | 'trips' | 'name'>('rating')
const busyId = ref<number | null>(null)

const formOpen = ref(false)
const editing = ref<AdminDriver | null>(null)
const formBusy = ref(false)
const formError = ref('')
const form = ref<InstanceType<typeof DriverForm> | null>(null)

const onTrip = computed(() => {
  const map = new Map<number, OrderView>()
  for (const order of orders.value) if (order.driverId && !isFinal(order.stage)) map.set(order.driverId, order)
  return map
})

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = drivers.value.filter((driver) => {
    if (filter.value === 'busy' && !onTrip.value.has(driver.id)) return false
    if (filter.value === 'blocked' && !driver.blocked) return false
    return !q || `${personName(driver)} ${driver.phone} ${driver.licenseNumber}`.toLowerCase().includes(q)
  })
  return list.sort((a, b) => {
    if (sort.value === 'trips') return b.ratingCount - a.ratingCount
    if (sort.value === 'name') return personName(a).localeCompare(personName(b), 'uk')
    return (b.rating ?? 0) - (a.rating ?? 0)
  })
})

const short = (driver: AdminDriver) => (driver.firstName.charAt(0) + driver.lastName.charAt(0)).toUpperCase() || 'В'
const stars = (rating: number | null) => Math.max(0, Math.min(5, rating ?? 0))
const tenure = (hire: string | null) => {
  if (!hire) return ''
  const months = Math.max(0, Math.round((Date.now() - Date.parse(hire)) / (30.4 * 86_400_000)))
  return months < 12 ? `${months} міс.` : `${Math.floor(months / 12)} р. ${months % 12 ? `${months % 12} міс.` : ''}`
}

async function load() {
  try {
    const [d, o] = await Promise.allSettled([adminApi.drivers(), adminApi.orders(1, 50)])
    if (d.status === 'rejected') throw d.reason
    drivers.value = d.value
    if (o.status === 'fulfilled') orders.value = o.value.data
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

function openCreate() {
  editing.value = null
  formError.value = ''
  formOpen.value = true
}

function openEdit(driver: AdminDriver) {
  editing.value = driver
  formError.value = ''
  formOpen.value = true
}

async function create(data: CreateDriverRequest) {
  formBusy.value = true
  formError.value = ''
  try {
    const driver = await adminApi.createDriver(data)
    drivers.value = [...drivers.value, driver]
    notify(`Водія ${personName(driver)} додано`)
    formOpen.value = false
  } catch (e) {
    formError.value = failMessage(e, 'Не вдалося створити водія')
  } finally {
    formBusy.value = false
  }
}

async function update(data: UpdateDriverRequest) {
  if (!editing.value) return
  formBusy.value = true
  formError.value = ''
  try {
    const driver = await adminApi.updateDriver(editing.value.id, data)
    drivers.value = drivers.value.map((item) => (item.id === driver.id ? driver : item))
    notify('Зміни збережено')
    formOpen.value = false
  } catch (e) {
    formError.value = failMessage(e, 'Не вдалося зберегти')
  } finally {
    formBusy.value = false
  }
}

async function toggleBlock(driver: AdminDriver) {
  const blocking = !driver.blocked
  const active = onTrip.value.get(driver.id)
  const ok = await confirm(
    blocking
      ? {
          title: `Заблокувати ${personName(driver, 'водія')}?`,
          text: active
            ? `Зараз водій виконує замовлення №${active.id}. Після блокування він не зможе приймати нові замовлення й входити в акаунт.`
            : 'Водій не зможе входити в акаунт і приймати замовлення. Історія поїздок і рейтинг збережуться.',
          action: 'Заблокувати',
          danger: true,
        }
      : { title: `Розблокувати ${personName(driver, 'водія')}?`, text: 'Водій знову зможе виходити на лінію.', action: 'Розблокувати' },
  )
  if (ok === false) return
  busyId.value = driver.id
  try {
    const updated = await adminApi.setDriverBlocked(driver.id, blocking)
    drivers.value = drivers.value.map((item) => (item.id === driver.id ? { ...updated, blocked: blocking } : item))
    notify(blocking ? 'Водія заблоковано' : 'Водія розблоковано')
  } catch (e) {
    notify(failMessage(e), 'error')
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Водії</h1>
        <p class="a-sub">{{ drivers.length }} у команді · {{ onTrip.size }} зараз на замовленні</p>
      </div>
      <button type="button" class="a-btn a-btn--primary" @click="openCreate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Новий водій
      </button>
    </header>

    <div class="a-toolbar">
      <label class="a-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input v-model="query" class="a-input" type="search" placeholder="Ім'я, телефон або посвідчення" aria-label="Пошук водіїв" />
      </label>
      <div class="a-chips">
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'all' }" @click="filter = 'all'">Усі</button>
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'busy' }" @click="filter = 'busy'">На замовленні <span class="a-chip__count">{{ onTrip.size }}</span></button>
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'blocked' }" @click="filter = 'blocked'">
          Заблоковані <span class="a-chip__count">{{ drivers.filter((driver) => driver.blocked).length }}</span>
        </button>
      </div>
      <select v-model="sort" class="a-select sort" aria-label="Сортування">
        <option value="rating">За рейтингом</option>
        <option value="trips">За кількістю поїздок</option>
        <option value="name">За ім'ям</option>
      </select>
    </div>

    <div v-if="state === 'loading'" class="grid">
      <span v-for="n in 6" :key="n" class="a-skeleton" style="height: 230px; border-radius: 22px"></span>
    </div>

    <div v-else-if="!visible.length" class="a-card a-empty">
      <strong>{{ state === 'error' ? 'Не вдалося завантажити водіїв' : 'Нікого не знайдено' }}</strong>
      <span v-if="state !== 'error'">Змініть фільтр або додайте нового водія</span>
    </div>

    <TransitionGroup v-else name="grid" tag="div" class="grid">
      <article v-for="driver in visible" :key="driver.id" class="a-card card" :class="{ 'card--off': driver.blocked }">
        <header class="card__head">
          <span class="a-avatar a-avatar--lg" :class="driver.blocked ? 'a-avatar--off' : 'a-avatar--dark'">{{ short(driver) }}</span>
          <div class="card__who">
            <p class="card__name">{{ personName(driver, 'Водій') }}</p>
            <p class="card__phone">{{ driver.phone || '—' }}</p>
            <span v-if="driver.blocked" class="a-badge a-badge--red">Заблоковано</span>
            <span v-else-if="onTrip.has(driver.id)" class="a-badge a-badge--blue a-badge--live">Замовлення №{{ onTrip.get(driver.id)!.id }}</span>
            <span v-else class="a-badge a-badge--green">Вільний</span>
          </div>
        </header>

        <div class="card__rating">
          <span class="stars" :style="{ '--rating': stars(driver.rating) }" aria-hidden="true">★★★★★</span>
          <strong>{{ driver.rating ? driver.rating.toFixed(2).replace('.', ',') : 'Новий' }}</strong>
          <span class="a-muted">· {{ driver.ratingCount }} оцінок</span>
        </div>

        <dl class="card__facts">
          <div>
            <dt>Посвідчення</dt>
            <dd>{{ driver.licenseNumber || '—' }}</dd>
          </div>
          <div>
            <dt>У команді</dt>
            <dd>{{ tenure(driver.hireDate) || formatDate(driver.hireDate) }}</dd>
          </div>
        </dl>

        <footer class="card__actions">
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" @click="openEdit(driver)">Редагувати</button>
          <button
            type="button"
            class="a-btn a-btn--sm"
            :class="driver.blocked ? 'a-btn--soft' : 'a-btn--danger'"
            :disabled="busyId === driver.id"
            @click="toggleBlock(driver)"
          >
            {{ driver.blocked ? 'Розблокувати' : 'Заблокувати' }}
          </button>
        </footer>
      </article>
    </TransitionGroup>

    <AdminDrawer
      :open="formOpen"
      wide
      :title="editing ? `Редагування: ${personName(editing, 'водій')}` : 'Новий водій'"
      :subtitle="editing ? `Водій №${editing.id}` : 'Створення акаунта водія'"
      @close="formOpen = false"
    >
      <DriverForm ref="form" :driver="editing" :busy="formBusy" :error="formError" @create="create" @update="update" />
      <template #footer>
        <button type="button" class="a-btn a-btn--ghost" @click="formOpen = false">Скасувати</button>
        <button type="button" class="a-btn a-btn--primary" :disabled="formBusy" @click="form?.submit()">
          <span v-if="formBusy" class="a-spinner"></span>
          <template v-else>{{ editing ? 'Зберегти' : 'Створити водія' }}</template>
        </button>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.sort {
  width: auto;
  margin-left: auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  transition:
    transform 0.25s var(--ease-out),
    box-shadow 0.25s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(40, 35, 20, 0.1);
}

.card--off {
  opacity: 0.7;
}

.card__head {
  display: flex;
  gap: 14px;
}

.card__who {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.card__name {
  margin: 0;
  overflow: hidden;
  max-width: 100%;
  font-size: 17px;
  font-weight: 800;
  color: var(--ink);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card__phone {
  margin: 0 0 4px;
  font-size: 13.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.card__rating {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.stars {
  --rating: 5;
  font-size: 15px;
  letter-spacing: 1px;
  background: linear-gradient(90deg, #e0a526 calc(var(--rating) / 5 * 100%), #e6dfcf 0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.card__facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f4efe3;
}

.card__facts dt {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.card__facts dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.card__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: auto;
}

.grid-enter-active,
.grid-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.35s var(--ease-out);
}

.grid-enter-from,
.grid-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

.grid-move {
  transition: transform 0.4s var(--ease-out);
}

@media (max-width: 720px) {
  .sort {
    width: 100%;
    margin-left: 0;
  }
}
</style>
