<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AdminDrawer from '@/components/admin/AdminDrawer.vue'
import { adminApi } from '@/api/admin'
import { PROMO_MAX, normalizePromo, validatePromo } from '@/api/orders'
import { useAdminUi } from '@/composables/useAdminUi'
import { formatDate, formatDiscount, isPercent } from '@/utils/admin'
import type { Promocode, PromocodeRequest } from '@/types/admin'

// swagger-final doesn't enumerate discount_type; these are the values this UI sends.
const TYPES = [
  { id: 'percent', label: 'Відсоток, %' },
  { id: 'fixed', label: 'Фіксована, ₴' },
]

const { notify, failMessage } = useAdminUi()

const promos = ref<Promocode[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const filter = ref<'all' | 'live' | 'off'>('all')
const busyId = ref<number | null>(null)
const copied = ref<number | null>(null)

const formOpen = ref(false)
const editing = ref<Promocode | null>(null)
const f = reactive({ code: '', type: 'percent', value: '', expiry: '', maxUses: '100', minOrder: '', maxDiscount: '' })
const touched = ref(false)
const saving = ref(false)
const formError = ref('')

const today = () => new Date().toISOString().slice(0, 10)
const isExpired = (promo: Promocode) => !!promo.expiryDate && promo.expiryDate < today()
const isExhausted = (promo: Promocode) => promo.maxUses > 0 && promo.usesCount >= promo.maxUses
const isLive = (promo: Promocode) => promo.active && !isExpired(promo) && !isExhausted(promo)

const visible = computed(() =>
  promos.value.filter((promo) => (filter.value === 'all' ? true : filter.value === 'live' ? isLive(promo) : !isLive(promo))),
)

function statusOf(promo: Promocode) {
  if (!promo.active) return { text: 'Вимкнено', tone: 'grey' }
  if (isExpired(promo)) return { text: 'Термін минув', tone: 'amber' }
  if (isExhausted(promo)) return { text: 'Вичерпано', tone: 'amber' }
  return { text: 'Діє', tone: 'green' }
}

const num = (value: string, opts: { int?: boolean; optional?: boolean } = {}) => {
  if (value.trim() === '') return opts.optional ? null : NaN
  const n = Number(value.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || (opts.int && !Number.isInteger(n))) return NaN
  return n
}

const errors = computed(() => {
  const value = num(f.value)
  return {
    code: validatePromo(f.code) ?? (!normalizePromo(f.code) ? 'Вкажіть код' : null),
    value: Number.isNaN(value) || value === 0
      ? 'Вкажіть знижку'
      : f.type === 'percent' && (value ?? 0) > 100
        ? 'Не більше 100%'
        : null,
    expiry: !f.expiry ? 'Вкажіть дату' : !editing.value && f.expiry < today() ? 'Дата вже минула' : null,
    maxUses: Number.isNaN(num(f.maxUses, { int: true })) || num(f.maxUses, { int: true }) === 0 ? 'Ціле число від 1' : null,
    minOrder: Number.isNaN(num(f.minOrder, { optional: true })) ? 'Число від 0' : null,
    maxDiscount: Number.isNaN(num(f.maxDiscount, { optional: true })) ? 'Число від 0' : null,
  }
})
const show = (key: keyof typeof errors.value) => (touched.value ? errors.value[key] : null)

const example = computed(() => {
  const value = num(f.value)
  if (value === null || Number.isNaN(value)) return null
  const amount = 200
  let discount = f.type === 'percent' ? (amount * value) / 100 : value
  const cap = num(f.maxDiscount, { optional: true })
  if (cap) discount = Math.min(discount, cap)
  const min = num(f.minOrder, { optional: true })
  if (min && amount < min) return `На поїздку 200 ₴ не діє — мінімальне замовлення ${min} ₴`
  return `Поїздка за 200 ₴ коштуватиме ${Math.max(0, Math.round(amount - discount))} ₴`
})

async function load() {
  try {
    promos.value = await adminApi.promocodes()
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

function generate() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  f.code = `UHIL${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`
}

function openForm(promo: Promocode | null) {
  editing.value = promo
  f.code = promo?.code ?? ''
  f.type = promo ? (isPercent(promo.discountType) ? 'percent' : 'fixed') : 'percent'
  f.value = promo ? String(promo.discountValue) : ''
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  f.expiry = promo?.expiryDate ?? nextMonth
  f.maxUses = promo ? String(promo.maxUses) : '100'
  f.minOrder = promo?.minOrderAmount !== null && promo?.minOrderAmount !== undefined ? String(promo.minOrderAmount) : ''
  f.maxDiscount = promo?.maxDiscountAmount !== null && promo?.maxDiscountAmount !== undefined ? String(promo.maxDiscountAmount) : ''
  touched.value = false
  formError.value = ''
  formOpen.value = true
}

async function save() {
  touched.value = true
  if (Object.values(errors.value).some(Boolean)) return
  const body: PromocodeRequest = {
    code: normalizePromo(f.code),
    discount_type: f.type,
    discount_value: num(f.value)!,
    expiry_date: f.expiry,
    max_uses: num(f.maxUses, { int: true })!,
    min_order_amount: num(f.minOrder, { optional: true }),
    max_discount_amount: f.type === 'percent' ? num(f.maxDiscount, { optional: true }) : null,
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      const updated = await adminApi.updatePromocode(editing.value.id, body)
      promos.value = promos.value.map((item) => (item.id === updated.id ? updated : item))
      notify(`Промокод ${updated.code} оновлено`)
    } else {
      const created = await adminApi.createPromocode(body)
      promos.value = [created, ...promos.value]
      notify(`Промокод ${created.code} створено`)
    }
    formOpen.value = false
  } catch (e) {
    formError.value = failMessage(e, 'Не вдалося зберегти промокод')
  } finally {
    saving.value = false
  }
}

async function toggle(promo: Promocode) {
  busyId.value = promo.id
  try {
    const updated = await adminApi.setPromocodeActive(promo.id, !promo.active)
    promos.value = promos.value.map((item) => (item.id === promo.id ? { ...updated, active: !promo.active } : item))
    notify(!promo.active ? `${promo.code} увімкнено` : `${promo.code} вимкнено`)
  } catch (e) {
    notify(failMessage(e), 'error')
  } finally {
    busyId.value = null
  }
}

async function copy(promo: Promocode) {
  try {
    await navigator.clipboard.writeText(promo.code)
    copied.value = promo.id
    window.setTimeout(() => (copied.value = null), 1500)
  } catch {
    notify('Не вдалося скопіювати', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Промокоди</h1>
        <p class="a-sub">{{ promos.filter(isLive).length }} діють зараз · {{ promos.reduce((sum, promo) => sum + promo.usesCount, 0) }} використань загалом</p>
      </div>
      <button type="button" class="a-btn a-btn--primary" @click="openForm(null)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Новий промокод
      </button>
    </header>

    <div class="a-chips">
      <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'all' }" @click="filter = 'all'">Усі <span class="a-chip__count">{{ promos.length }}</span></button>
      <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'live' }" @click="filter = 'live'">Діють <span class="a-chip__count">{{ promos.filter(isLive).length }}</span></button>
      <button type="button" class="a-chip" :class="{ 'a-chip--active': filter === 'off' }" @click="filter = 'off'">
        Неактивні <span class="a-chip__count">{{ promos.filter((promo) => !isLive(promo)).length }}</span>
      </button>
    </div>

    <article class="a-card">
      <div class="a-table-wrap">
        <table class="a-table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Знижка</th>
              <th class="a-hide-sm">Використано</th>
              <th class="a-hide-sm">Діє до</th>
              <th>Статус</th>
              <th class="a-num">Активний</th>
            </tr>
          </thead>
          <tbody v-if="state === 'loading'">
            <tr v-for="n in 4" :key="n"><td colspan="6"><span class="a-skeleton" style="height: 22px"></span></td></tr>
          </tbody>
          <tbody v-else>
            <tr v-for="promo in visible" :key="promo.id" @click="openForm(promo)">
              <td>
                <span class="code">
                  <span class="code__text">{{ promo.code }}</span>
                  <button type="button" class="code__copy" :aria-label="`Скопіювати ${promo.code}`" @click.stop="copy(promo)">
                    <svg v-if="copied === promo.id" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
                  </button>
                </span>
              </td>
              <td>
                <span class="a-strong">{{ formatDiscount(promo) }}</span>
                <span class="a-person__meta">
                  {{ [promo.minOrderAmount ? `від ${promo.minOrderAmount} ₴` : '', promo.maxDiscountAmount ? `макс. ${promo.maxDiscountAmount} ₴` : ''].filter(Boolean).join(' · ') }}
                </span>
              </td>
              <td class="a-hide-sm">
                <span class="usage">
                  <span class="usage__track"><span class="usage__fill" :style="{ width: `${Math.min(100, (promo.usesCount / Math.max(1, promo.maxUses)) * 100)}%` }"></span></span>
                  <span class="usage__text">{{ promo.usesCount }} / {{ promo.maxUses }}</span>
                </span>
              </td>
              <td class="a-hide-sm">{{ formatDate(promo.expiryDate) }}</td>
              <td><span class="a-badge" :class="`a-badge--${statusOf(promo).tone}`">{{ statusOf(promo).text }}</span></td>
              <td class="a-num" @click.stop>
                <button
                  type="button"
                  class="a-switch"
                  :class="{ 'a-switch--on': promo.active }"
                  role="switch"
                  :aria-checked="promo.active"
                  :aria-label="promo.active ? `Вимкнути ${promo.code}` : `Увімкнути ${promo.code}`"
                  :disabled="busyId === promo.id"
                  @click="toggle(promo)"
                ></button>
              </td>
            </tr>
            <tr v-if="!visible.length">
              <td colspan="6">
                <div class="a-empty">
                  <strong>{{ state === 'error' ? 'Не вдалося завантажити промокоди' : 'Промокодів немає' }}</strong>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <AdminDrawer :open="formOpen" :title="editing ? `Промокод ${editing.code}` : 'Новий промокод'" :subtitle="editing ? `Використано ${editing.usesCount} з ${editing.maxUses}` : 'Знижка для клієнтів UhilTaxi'" @close="formOpen = false">
      <form class="form" novalidate @submit.prevent="save">
        <label class="a-field">
          <span class="a-label">Код</span>
          <span class="code-input">
            <input v-model="f.code" class="a-input code-input__field" :class="{ 'a-input--invalid': show('code') }" :maxlength="PROMO_MAX" placeholder="UHIL20" autocomplete="off" />
            <button type="button" class="a-btn a-btn--ghost" @click="generate">Згенерувати</button>
          </span>
          <span v-if="show('code')" class="a-error">{{ show('code') }}</span>
        </label>

        <div class="a-grid">
          <label class="a-field">
            <span class="a-label">Тип знижки</span>
            <select v-model="f.type" class="a-select">
              <option v-for="item in TYPES" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
          <label class="a-field">
            <span class="a-label">{{ f.type === 'percent' ? 'Знижка, %' : 'Знижка, ₴' }}</span>
            <input v-model="f.value" class="a-input" :class="{ 'a-input--invalid': show('value') }" inputmode="decimal" :placeholder="f.type === 'percent' ? '20' : '50'" />
            <span v-if="show('value')" class="a-error">{{ show('value') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">Діє до</span>
            <input v-model="f.expiry" class="a-input" :class="{ 'a-input--invalid': show('expiry') }" type="date" />
            <span v-if="show('expiry')" class="a-error">{{ show('expiry') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">Ліміт використань</span>
            <input v-model="f.maxUses" class="a-input" :class="{ 'a-input--invalid': show('maxUses') }" inputmode="numeric" />
            <span v-if="show('maxUses')" class="a-error">{{ show('maxUses') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">Мін. сума замовлення, ₴</span>
            <input v-model="f.minOrder" class="a-input" :class="{ 'a-input--invalid': show('minOrder') }" inputmode="decimal" placeholder="Без обмежень" />
            <span v-if="show('minOrder')" class="a-error">{{ show('minOrder') }}</span>
          </label>
          <label v-if="f.type === 'percent'" class="a-field">
            <span class="a-label">Макс. знижка, ₴</span>
            <input v-model="f.maxDiscount" class="a-input" :class="{ 'a-input--invalid': show('maxDiscount') }" inputmode="decimal" placeholder="Без обмежень" />
            <span v-if="show('maxDiscount')" class="a-error">{{ show('maxDiscount') }}</span>
          </label>
        </div>

        <p v-if="example" class="a-alert a-alert--info">{{ example }}</p>
        <p v-if="formError" class="a-alert">{{ formError }}</p>
        <button type="submit" hidden></button>
      </form>
      <template #footer>
        <button type="button" class="a-btn a-btn--ghost" @click="formOpen = false">Скасувати</button>
        <button type="button" class="a-btn a-btn--primary" :disabled="saving" @click="save">
          <span v-if="saving" class="a-spinner"></span>
          <template v-else>{{ editing ? 'Зберегти' : 'Створити промокод' }}</template>
        </button>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.code {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.code__text {
  padding: 5px 10px;
  border: 1.5px dashed var(--green);
  border-radius: 9px;
  background: var(--green-soft);
  color: var(--green);
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.code__copy {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.code__copy:hover {
  background: #f1ebdd;
  color: var(--ink);
}

.code__copy svg {
  width: 16px;
  height: 16px;
}

.usage {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 150px;
}

.usage__track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: #f1ebdd;
  overflow: hidden;
}

.usage__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--green);
}

.usage__text {
  font-size: 12.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.code-input {
  display: flex;
  gap: 8px;
}

.code-input__field {
  flex: 1;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
