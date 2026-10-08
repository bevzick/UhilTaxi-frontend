<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminDrawer from '@/components/admin/AdminDrawer.vue'
import DriverForm from '@/components/admin/DriverForm.vue'
import StageBadge from '@/components/admin/StageBadge.vue'
import { adminApi } from '@/api/admin'
import { useAdminUi } from '@/composables/useAdminUi'
import { formatDate, personName } from '@/utils/admin'
import { formatFare, timeAgo } from '@/utils/order'
import type { AdminClient, AdminDriver, CreateDriverRequest } from '@/types/admin'
import type { OrderView } from '@/types/order'

const router = useRouter()
const { notify, confirm, failMessage } = useAdminUi()

const clients = ref<AdminClient[]>([])
const drivers = ref<AdminDriver[]>([])
const orders = ref<OrderView[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const query = ref('')
const filter = ref<'all' | 'active' | 'blocked'>('all')
const openId = ref<number | null>(null)
const busyId = ref<number | null>(null)

const promoteFor = ref<AdminClient | null>(null)
const promoteBusy = ref(false)
const promoteError = ref('')
const driverForm = ref<InstanceType<typeof DriverForm> | null>(null)

const opened = computed(() => clients.value.find((client) => client.id === openId.value) ?? null)
const driverPhones = computed(() => new Set(drivers.value.map((driver) => driver.phone)))
const ordersByClient = computed(() => {
  const map = new Map<number, OrderView[]>()
  for (const order of orders.value) {
    if (!order.clientId) continue
    map.set(order.clientId, [...(map.get(order.clientId) ?? []), order])
  }
  return map
})

const counts = computed(() => ({
  all: clients.value.length,
  active: clients.value.filter((client) => !client.blocked).length,
  blocked: clients.value.filter((client) => client.blocked).length,
}))

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return clients.value.filter((client) => {
    if (filter.value === 'active' && client.blocked) return false
    if (filter.value === 'blocked' && !client.blocked) return false
    return !q || `${personName(client)} ${client.phone} ${client.email} ${client.id}`.toLowerCase().includes(q)
  })
})

const openedOrders = computed(() => (opened.value ? ordersByClient.value.get(opened.value.id) ?? [] : []))
const openedSpent = computed(() => openedOrders.value.filter((order) => order.stage === 'completed').reduce((sum, order) => sum + (order.fare ?? 0), 0))

const short = (client: AdminClient) => (client.firstName.charAt(0) + client.lastName.charAt(0)).toUpperCase() || 'К'

async function load() {
  try {
    const [c, d, o] = await Promise.allSettled([adminApi.clients(), adminApi.drivers(), adminApi.orders(1, 50)])
    if (c.status === 'rejected') throw c.reason
    clients.value = c.value
    if (d.status === 'fulfilled') drivers.value = d.value
    if (o.status === 'fulfilled') orders.value = o.value.data
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

async function toggleBlock(client: AdminClient) {
  const blocking = !client.blocked
  const ok = await confirm(
    blocking
      ? {
          title: `Заблокувати ${personName(client, 'клієнта')}?`,
          text: 'Клієнт не зможе входити в акаунт і створювати замовлення. Дані та історія поїздок збережуться — розблокувати можна будь-коли.',
          action: 'Заблокувати',
          danger: true,
        }
      : { title: `Розблокувати ${personName(client, 'клієнта')}?`, text: 'Клієнт знову зможе користуватися UhilTaxi.', action: 'Розблокувати' },
  )
  if (ok === false) return
  busyId.value = client.id
  try {
    const updated = await adminApi.setClientBlocked(client.id, blocking)
    clients.value = clients.value.map((item) => (item.id === client.id ? { ...updated, blocked: blocking } : item))
    notify(blocking ? 'Акаунт заблоковано' : 'Акаунт розблоковано')
  } catch (e) {
    notify(failMessage(e), 'error')
  } finally {
    busyId.value = null
  }
}

function startPromote(client: AdminClient) {
  promoteError.value = ''
  promoteFor.value = client
}

async function promote(data: CreateDriverRequest) {
  promoteBusy.value = true
  promoteError.value = ''
  try {
    const driver = await adminApi.createDriver(data)
    drivers.value = [...drivers.value, driver]
    notify(`${personName(driver, 'Водій')} тепер водій UhilTaxi`)
    promoteFor.value = null
  } catch (e) {
    promoteError.value =
      failMessage(e, 'Не вдалося створити водія') +
      (e instanceof Error && /існує|exist|409/i.test(e.message)
        ? '. Сервер не дозволяє другий акаунт з тим самим телефоном — вкажіть інший номер'
        : '')
  } finally {
    promoteBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Клієнти</h1>
        <p class="a-sub">{{ counts.all }} зареєстрованих · {{ counts.blocked }} заблоковано</p>
      </div>
    </header>

    <div class="a-toolbar">
      <label class="a-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input v-model="query" class="a-input" type="search" placeholder="Ім'я, телефон, email або №" aria-label="Пошук клієнтів" />
      </label>
      <div class="a-chips">
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'all' }" @click="filter = 'all'">Усі <span class="a-chip__count">{{ counts.all }}</span></button>
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'active' }" @click="filter = 'active'">Активні <span class="a-chip__count">{{ counts.active }}</span></button>
        <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'blocked' }" @click="filter = 'blocked'">Заблоковані <span class="a-chip__count">{{ counts.blocked }}</span></button>
      </div>
    </div>

    <article class="a-card">
      <div class="a-table-wrap">
        <table class="a-table">
          <thead>
            <tr>
              <th>Клієнт</th>
              <th class="a-hide-sm">Email</th>
              <th class="a-hide-sm">Дата народження</th>
              <th class="a-num a-hide-sm">Поїздок</th>
              <th>Статус</th>
              <th class="a-num"></th>
            </tr>
          </thead>
          <tbody v-if="state === 'loading'">
            <tr v-for="n in 6" :key="n"><td colspan="6"><span class="a-skeleton" style="height: 22px"></span></td></tr>
          </tbody>
          <tbody v-else>
            <tr v-for="client in visible" :key="client.id" :class="{ 'row--off': client.blocked }" @click="openId = client.id">
              <td>
                <span class="a-person">
                  <span class="a-avatar" :class="{ 'a-avatar--off': client.blocked }">{{ short(client) }}</span>
                  <span>
                    <span class="a-person__name">{{ personName(client, 'Клієнт') }}</span>
                    <span class="a-person__meta">{{ client.phone || '—' }}</span>
                  </span>
                </span>
              </td>
              <td class="a-hide-sm"><span class="a-ellipsis">{{ client.email || '—' }}</span></td>
              <td class="a-hide-sm">{{ formatDate(client.birthDate) }}</td>
              <td class="a-num a-hide-sm">{{ ordersByClient.get(client.id)?.length ?? 0 }}</td>
              <td>
                <span v-if="client.blocked" class="a-badge a-badge--red">Заблоковано</span>
                <span v-else-if="driverPhones.has(client.phone)" class="a-badge a-badge--blue">Також водій</span>
                <span v-else class="a-badge a-badge--green">Активний</span>
              </td>
              <td class="a-num" @click.stop>
                <button
                  type="button"
                  class="a-btn a-btn--sm"
                  :class="client.blocked ? 'a-btn--soft' : 'a-btn--ghost'"
                  :disabled="busyId === client.id"
                  @click="toggleBlock(client)"
                >
                  {{ client.blocked ? 'Розблокувати' : 'Заблокувати' }}
                </button>
              </td>
            </tr>
            <tr v-if="!visible.length">
              <td colspan="6">
                <div class="a-empty">
                  <strong>{{ state === 'error' ? 'Не вдалося завантажити клієнтів' : 'Нікого не знайдено' }}</strong>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <AdminDrawer :open="!!opened" :title="opened ? personName(opened, 'Клієнт') : ''" :subtitle="opened ? `Клієнт №${opened.id}` : ''" @close="openId = null">
      <template v-if="opened">
        <div class="profile">
          <span class="a-avatar a-avatar--lg" :class="opened.blocked ? 'a-avatar--off' : 'a-avatar--dark'">{{ short(opened) }}</span>
          <div>
            <span v-if="opened.blocked" class="a-badge a-badge--red">Заблоковано</span>
            <span v-else class="a-badge a-badge--green">Активний</span>
            <p class="profile__phone">{{ opened.phone }}</p>
          </div>
        </div>

        <div class="stats">
          <div class="stats__item">
            <span class="stats__value">{{ openedOrders.length }}</span>
            <span class="stats__label">замовлень</span>
          </div>
          <div class="stats__item">
            <span class="stats__value">{{ openedOrders.filter((order) => order.stage === 'completed').length }}</span>
            <span class="stats__label">поїздок</span>
          </div>
          <div class="stats__item">
            <span class="stats__value">{{ formatFare(openedSpent) }}</span>
            <span class="stats__label">витрачено</span>
          </div>
        </div>

        <dl class="a-dl">
          <dt>Email</dt>
          <dd>{{ opened.email || '—' }}</dd>
          <dt>Дата народження</dt>
          <dd>{{ formatDate(opened.birthDate) }}</dd>
          <dt>Статус API</dt>
          <dd>{{ opened.status }}</dd>
        </dl>

        <section>
          <h3 class="section-title">Останні замовлення</h3>
          <ul class="mini-orders">
            <li v-for="order in openedOrders.slice(0, 5)" :key="order.id">
              <button type="button" class="mini-orders__item" @click="router.push({ name: 'admin-orders', query: { id: String(order.id) } })">
                <span class="mini-orders__route">
                  <span class="a-strong">№{{ order.id }}</span>
                  <span class="a-ellipsis">{{ order.destination.address }}</span>
                </span>
                <StageBadge :stage="order.stage" />
                <span class="a-muted mini-orders__ago">{{ timeAgo(order.createdAt) }}</span>
              </button>
            </li>
            <li v-if="!openedOrders.length" class="a-muted">Замовлень ще немає</li>
          </ul>
        </section>
      </template>

      <template #footer>
        <template v-if="opened">
          <button type="button" class="a-btn" :class="opened.blocked ? 'a-btn--soft' : 'a-btn--danger'" :disabled="busyId === opened.id" @click="toggleBlock(opened)">
            {{ opened.blocked ? 'Розблокувати' : 'Заблокувати акаунт' }}
          </button>
          <button type="button" class="a-btn a-btn--dark" :disabled="opened.blocked" @click="startPromote(opened)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 17v-4.5L8 7h8l3 5.5V17M3 17h18M7.5 17v2M16.5 17v2" />
            </svg>
            Зробити водієм
          </button>
        </template>
      </template>
    </AdminDrawer>

    <AdminDrawer
      :open="!!promoteFor"
      wide
      title="Зробити водієм"
      :subtitle="promoteFor ? `На основі профілю: ${personName(promoteFor, 'клієнт')}` : ''"
      @close="promoteFor = null"
    >
      <p class="a-alert a-alert--info">
        Дані клієнта вже підставлено. Додайте посвідчення водія, дату прийому і тимчасовий пароль — буде створено акаунт водія.
      </p>
      <DriverForm
        ref="driverForm"
        :seed="promoteFor ? { firstName: promoteFor.firstName, lastName: promoteFor.lastName, phone: promoteFor.phone, email: promoteFor.email } : null"
        :busy="promoteBusy"
        :error="promoteError"
        @create="promote"
      />
      <template #footer>
        <button type="button" class="a-btn a-btn--ghost" @click="promoteFor = null">Скасувати</button>
        <button type="button" class="a-btn a-btn--primary" :disabled="promoteBusy" @click="driverForm?.submit()">
          <span v-if="promoteBusy" class="a-spinner"></span>
          <template v-else>Створити водія</template>
        </button>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.row--off td {
  opacity: 0.6;
}

.profile {
  display: flex;
  align-items: center;
  gap: 16px;
}

.profile__phone {
  margin: 8px 0 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border-radius: 16px;
}

.stats__item {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  background: var(--ink);
  color: #fbf7ee;
}

.stats__value {
  font-size: 18px;
  font-weight: 800;
}

.stats__label {
  font-size: 12px;
  color: #b8b2a2;
}

.section-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.mini-orders {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mini-orders__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  font-family: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.mini-orders__item:hover {
  border-color: var(--line-strong);
}

.mini-orders__route {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.mini-orders__ago {
  font-size: 12px;
  white-space: nowrap;
}
</style>
