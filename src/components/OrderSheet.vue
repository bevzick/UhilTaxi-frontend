<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AddressInput from '@/components/AddressInput.vue'
import { ApiError } from '@/api/http'
import { PROMO_MAX, normalizePromo, ordersApi, prepareOrder, validatePromo } from '@/api/orders'
import { formatFare, formatKm } from '@/utils/order'
import type { CreateOrderRequest, Estimate, OrderView, Tariff } from '@/types/order'
import type { Place } from '@/types/geo'

const ESTIMATE_DEBOUNCE_MS = 400

const props = defineProps<{
  open: boolean
  pickup: Place | null
  destination: Place | null
  myPlace: Place | null
}>()

const emit = defineEmits<{
  close: []
  created: [order: OrderView, request: CreateOrderRequest]
  'update:pickup': [value: Place | null]
  'update:destination': [value: Place | null]
}>()

const CLASS_TEXT: Record<string, string> = {
  economy: 'Щоденні поїздки',
  standard: 'Щоденні поїздки',
  comfort: 'Більше простору',
  business: 'Преміум авто',
  premium: 'Преміум авто',
  minivan: 'До 7 пасажирів',
}

const tariffs = ref<Tariff[]>([])
const tariffsState = ref<'loading' | 'ready' | 'error'>('loading')
const tariffId = ref<number | null>(null)
const estimates = ref<Record<number, Estimate | 'loading' | 'error'>>({})
const promoInput = ref('')
const promo = ref('')
const promoOpen = ref(false)
const promoError = ref('')
const sending = ref(false)
const error = ref('')
const openCount = ref(0)

let estimateTimer = 0
let estimateRun = 0

const pickupModel = computed({
  get: () => props.pickup,
  set: (value) => emit('update:pickup', value),
})

const destinationModel = computed({
  get: () => props.destination,
  set: (value) => emit('update:destination', value),
})

const routeReady = computed(() => !!props.pickup && !!props.destination && !props.pickup.pending && !props.destination.pending)
const selected = computed(() => tariffs.value.find((item) => item.id === tariffId.value) ?? null)
const selectedEstimate = computed(() => {
  const value = tariffId.value === null ? undefined : estimates.value[tariffId.value]
  return typeof value === 'object' ? value : null
})
const canSubmit = computed(() => routeReady.value && !!selected.value && !sending.value)
const canUseMe = computed(() => !!props.myPlace && props.pickup?.source !== 'me')

function tierOf(tariff: Tariff, index: number) {
  if (/business|premium|vip/.test(tariff.serviceClass)) return 2
  if (/comfort/.test(tariff.serviceClass)) return 1
  if (/econom|standard/.test(tariff.serviceClass)) return 0
  return Math.min(2, index)
}

async function loadTariffs() {
  tariffsState.value = 'loading'
  try {
    const list = await ordersApi.tariffs()
    tariffs.value = list
    tariffsState.value = list.length ? 'ready' : 'error'
    if (tariffId.value === null || !list.some((item) => item.id === tariffId.value)) {
      tariffId.value = (list.find((item) => /comfort/.test(item.serviceClass)) ?? list[0])?.id ?? null
    }
    queueEstimate()
  } catch {
    tariffsState.value = 'error'
  }
}

function draftFor(id: number, code: string) {
  return prepareOrder({ pickup: props.pickup, destination: props.destination, tariffId: id, promocode: code })
}

function queueEstimate() {
  clearTimeout(estimateTimer)
  if (!routeReady.value || !tariffs.value.length) {
    estimates.value = {}
    return
  }
  estimateTimer = window.setTimeout(runEstimate, ESTIMATE_DEBOUNCE_MS)
}

async function runEstimate() {
  const run = ++estimateRun
  const code = promo.value
  estimates.value = Object.fromEntries(tariffs.value.map((item) => [item.id, 'loading']))

  await Promise.all(
    tariffs.value.map(async (tariff) => {
      const draft = draftFor(tariff.id, code)
      let result: Estimate | 'error' = 'error'
      if ('data' in draft) {
        try {
          result = await ordersApi.estimate(draft.data)
        } catch (e) {
          if (code && e instanceof ApiError && e.status >= 400 && e.status < 500 && run === estimateRun) {
            promoError.value = e.message
            promo.value = ''
            queueEstimate()
          }
        }
      }
      if (run === estimateRun) estimates.value = { ...estimates.value, [tariff.id]: result }
    }),
  )
}

function applyPromo() {
  promoError.value = validatePromo(promoInput.value) ?? ''
  if (promoError.value) return
  promo.value = normalizePromo(promoInput.value)
  promoInput.value = promo.value
  queueEstimate()
}

function removePromo() {
  promo.value = ''
  promoInput.value = ''
  promoError.value = ''
  queueEstimate()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    openCount.value++
    error.value = ''
    if (tariffsState.value !== 'ready') loadTariffs()
    else queueEstimate()
  },
)

watch(
  () => [props.pickup, props.destination],
  () => {
    error.value = ''
    if (props.open) queueEstimate()
  },
)

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !sending.value) emit('close')
}

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(estimateTimer)
})

function swap() {
  const from = props.pickup
  emit('update:pickup', props.destination)
  emit('update:destination', from)
}

function useMe() {
  if (props.myPlace) emit('update:pickup', { ...props.myPlace })
}

async function submit() {
  if (!canSubmit.value || tariffId.value === null) return
  error.value = ''

  const prepared = draftFor(tariffId.value, promo.value)
  if ('error' in prepared) {
    error.value = prepared.error
    return
  }

  sending.value = true
  try {
    const order = await ordersApi.create(prepared.data)
    emit('created', order, prepared.data)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Не вдалося створити замовлення. Спробуйте ще раз'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Transition name="sheet">
    <aside v-show="open" class="sheet" aria-label="Нове замовлення">
      <div class="sheet__grip" aria-hidden="true"></div>

      <div :key="`form-${openCount}`" class="sheet__inner">
        <header class="sheet__head item" style="--i: 0">
          <div>
            <h2 class="sheet__title">Оберіть тариф</h2>
            <p class="sheet__sub">Ціна фіксується в момент замовлення</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Закрити" :disabled="sending" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div class="sheet__scroll">
          <section class="block item" style="--i: 1">
            <div class="block__head">
              <h3 class="block__title">Маршрут</h3>
              <button v-if="canUseMe" type="button" class="link-btn" @click="useMe">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                Звідси
              </button>
            </div>

            <div class="route">
              <AddressInput v-model="pickupModel" input-id="order-from" variant="from" label="Звідки" placeholder="Адреса посадки" />
              <button type="button" class="route__swap" aria-label="Поміняти місцями" @click="swap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                </svg>
              </button>
              <AddressInput v-model="destinationModel" input-id="order-to" variant="to" label="Куди" placeholder="Куди їдемо?" />
            </div>

            <Transition name="fade">
              <p v-if="selectedEstimate" class="route__meta">
                <span class="route__dot"></span>
                {{ formatKm(selectedEstimate.distanceKm) }} · ≈ {{ selectedEstimate.durationMin }} хв у дорозі
              </p>
            </Transition>
          </section>

          <section class="block item" style="--i: 2">
            <h3 class="block__title">Тариф</h3>

            <div v-if="tariffsState === 'loading'" class="tariffs">
              <span v-for="n in 3" :key="n" class="tariff tariff--skeleton"></span>
            </div>

            <div v-else-if="tariffsState === 'error'" class="empty">
              <p>Не вдалося завантажити тарифи</p>
              <button type="button" class="link-btn" @click="loadTariffs">Спробувати ще раз</button>
            </div>

            <div v-else class="tariffs" role="radiogroup" aria-label="Тариф">
              <button
                v-for="(item, index) in tariffs"
                :key="item.id"
                type="button"
                role="radio"
                class="tariff"
                :class="{ 'tariff--active': tariffId === item.id }"
                :aria-checked="tariffId === item.id"
                :style="{ '--i': index }"
                @click="tariffId = item.id"
              >
                <svg class="tariff__icon" viewBox="0 0 48 24" aria-hidden="true">
                  <path d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
                  <circle cx="14" cy="18" r="3.2" fill="currentColor" />
                  <circle cx="35" cy="18" r="3.2" fill="currentColor" />
                  <path v-if="tierOf(item, index) >= 1" d="M14 8h7v4.5h-9z" fill="currentColor" opacity="0.35" />
                  <path v-if="tierOf(item, index) >= 2" d="M24 8h8l4 4.5H24z" fill="currentColor" opacity="0.35" />
                </svg>
                <span class="tariff__name">{{ item.name }}</span>
                <span class="tariff__text">{{ CLASS_TEXT[item.serviceClass] ?? `від ${formatFare(item.baseFare)}` }}</span>
                <span class="tariff__price">
                  <span v-if="estimates[item.id] === 'loading'" class="shimmer"></span>
                  <template v-else-if="typeof estimates[item.id] === 'object'">
                    {{ formatFare((estimates[item.id] as Estimate).fare) }}
                  </template>
                  <template v-else-if="!routeReady">—</template>
                  <template v-else>від {{ formatFare(item.baseFare) }}</template>
                </span>
                <span class="tariff__check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              </button>
            </div>
          </section>

          <section class="block item" style="--i: 3">
            <button v-if="!promoOpen && !promo" type="button" class="promo-toggle" @click="promoOpen = true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 12V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v0a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v0a2 2 0 0 1 0-4Z" />
                <path d="M10 9l4 6M10 15h.01M14 9h.01" />
              </svg>
              Є промокод?
            </button>

            <div v-else-if="promo" class="promo-applied">
              <span class="promo-applied__code">{{ promo }}</span>
              <span v-if="selectedEstimate?.discountAmount" class="promo-applied__save">
                −{{ formatFare(selectedEstimate.discountAmount) }}
              </span>
              <button type="button" class="promo-applied__remove" aria-label="Прибрати промокод" @click="removePromo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <form v-else class="promo" @submit.prevent="applyPromo">
              <label class="sr-only" for="order-promo">Промокод</label>
              <input
                id="order-promo"
                v-model="promoInput"
                class="promo__input"
                :class="{ 'promo__input--invalid': promoError }"
                :maxlength="PROMO_MAX"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                placeholder="Промокод"
              />
              <button type="submit" class="promo__btn" :disabled="!promoInput.trim()">Застосувати</button>
            </form>
            <Transition name="fade">
              <p v-if="promoError" class="promo__error">{{ promoError }}</p>
            </Transition>
          </section>
        </div>

        <footer class="sheet__foot item" style="--i: 4">
          <Transition name="alert">
            <p v-if="error" class="alert" role="alert">{{ error }}</p>
          </Transition>
          <button type="button" class="next" :disabled="!canSubmit" :class="{ 'next--sending': sending }" @click="submit">
            <span class="next__shine"></span>
            <Transition name="fade" mode="out-in">
              <span v-if="sending" key="sending" class="next__content">
                <span class="next__spinner"></span>
                Надсилаємо…
              </span>
              <span v-else key="idle" class="next__content">
                Замовити
                <template v-if="selectedEstimate">· {{ formatFare(selectedEstimate.fare) }}</template>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </Transition>
          </button>
        </footer>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.sheet {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  position: absolute;
  top: 88px;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: 420px;
  border: 1px solid #ece5d6;
  border-radius: 28px;
  background: rgba(251, 247, 238, 0.97);
  box-shadow: 0 30px 80px rgba(40, 35, 20, 0.22);
  overflow: hidden;
}

.sheet__grip {
  display: none;
}

.sheet__inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.item {
  animation: item-in 0.5s calc(0.12s + var(--i) * 45ms) var(--ease-out) backwards;
}

.sheet__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 24px 8px;
}

.sheet__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2b2b26;
}

.sheet__sub {
  margin: 4px 0 0;
  font-size: 14px;
  color: #8a8578;
}

.icon-btn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 12px;
  background: #f1ebdd;
  color: #4a473f;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    transform 0.25s var(--ease-out);
}

.icon-btn:hover:not(:disabled) {
  background: #e6dfcf;
  transform: rotate(90deg);
}

.icon-btn svg {
  width: 18px;
  height: 18px;
}

.sheet__scroll {
  flex: 1;
  min-height: 0;
  padding: 8px 24px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #e0d8c6 transparent;
}

.block {
  padding: 16px 0;
  border-bottom: 1px solid #efe8d9;
}

.block:last-child {
  border-bottom: none;
}

.block__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.block__head .block__title {
  margin: 0;
}

.block__title {
  display: block;
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: #2b2b26;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  background: #e3efe7;
  color: #2f7d57;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s var(--ease-out);
}

.link-btn:hover {
  transform: translateY(-1px);
}

.link-btn svg {
  width: 15px;
  height: 15px;
}

.route {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.route__swap {
  position: absolute;
  top: 50%;
  right: 52px;
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
  transform: translateY(-50%);
  transition:
    transform 0.4s var(--ease-out),
    border-color 0.2s ease,
    color 0.2s ease;
}

.route__swap:hover {
  border-color: #2f7d57;
  color: #2f7d57;
  transform: translateY(-50%) rotate(180deg);
}

.route__swap svg {
  width: 15px;
  height: 15px;
}

.route__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: #6b675c;
}

.route__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2f7d57;
  animation: pulse 2s infinite;
}

.tariffs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
}

.tariff {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 136px;
  padding: 14px 12px 12px;
  border: 1.5px solid #e6dfcf;
  border-radius: 16px;
  background: #fffdf8;
  color: #8a8578;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  animation: item-in 0.4s calc(var(--i, 0) * 60ms) var(--ease-out) backwards;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.25s var(--ease-out),
    box-shadow 0.25s ease;
}

.tariff:hover {
  transform: translateY(-2px);
  border-color: #d6cdb8;
}

.tariff--active {
  border-color: #2f7d57;
  background: #ffffff;
  color: #2f7d57;
  box-shadow: 0 10px 24px rgba(47, 125, 87, 0.14);
}

.tariff--skeleton {
  border-color: transparent;
  background: linear-gradient(90deg, #f1ebdd 25%, #f8f4ea 50%, #f1ebdd 75%);
  background-size: 200% 100%;
  animation: shimmer 1.1s linear infinite;
  cursor: default;
}

.tariff__icon {
  width: 46px;
  height: 24px;
  margin-bottom: 8px;
  transition: transform 0.35s var(--ease-out);
}

.tariff--active .tariff__icon {
  transform: translateX(4px);
}

.tariff__name {
  font-size: 14px;
  font-weight: 700;
  color: #2b2b26;
}

.tariff__text {
  font-size: 11.5px;
  line-height: 1.35;
  color: #8a8578;
}

.tariff__price {
  display: flex;
  align-items: center;
  min-height: 22px;
  margin-top: auto;
  padding-top: 8px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #2b2b26;
}

.tariff--active .tariff__price {
  color: #2f7d57;
}

.shimmer {
  display: block;
  width: 56px;
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(90deg, #f1ebdd 25%, #f8f4ea 50%, #f1ebdd 75%);
  background-size: 200% 100%;
  animation: shimmer 1.1s linear infinite;
}

.tariff__check {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #2f7d57;
  color: #ffffff;
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity 0.2s ease,
    transform 0.35s cubic-bezier(0.34, 1.6, 0.5, 1);
}

.tariff__check svg {
  width: 12px;
  height: 12px;
}

.tariff--active .tariff__check {
  opacity: 1;
  transform: scale(1);
}

.empty {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: #f7eedb;
  color: #7a5a1e;
  font-size: 13.5px;
}

.empty p {
  margin: 0;
}

.promo-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: none;
  color: #2f7d57;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.promo-toggle svg {
  width: 20px;
  height: 20px;
}

.promo {
  display: flex;
  gap: 8px;
  animation: item-in 0.3s var(--ease-out) backwards;
}

.promo__input {
  flex: 1;
  min-width: 0;
  height: 46px;
  padding: 0 14px;
  border: 1.5px solid #e6dfcf;
  border-radius: 14px;
  background: #fffdf8;
  color: #2b2b26;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease;
}

.promo__input::placeholder {
  color: #b5ae9f;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.promo__input:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 4px rgba(47, 125, 87, 0.12);
}

.promo__input--invalid {
  border-color: #c2543f;
}

.promo__btn {
  flex-shrink: 0;
  padding: 0 16px;
  border: none;
  border-radius: 14px;
  background: #2b2b26;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.promo__btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.promo__error {
  margin: 8px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: #9f3a28;
}

.promo-applied {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border: 1.5px dashed #2f7d57;
  border-radius: 14px;
  background: #e3efe7;
}

.promo-applied__code {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #2f7d57;
}

.promo-applied__save {
  padding: 3px 8px;
  border-radius: 999px;
  background: #2f7d57;
  color: #fbf7ee;
  font-size: 12.5px;
  font-weight: 700;
}

.promo-applied__remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(47, 125, 87, 0.12);
  color: #2f7d57;
  cursor: pointer;
}

.promo-applied__remove svg {
  width: 12px;
  height: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.sheet__foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 24px 22px;
  border-top: 1px solid #efe8d9;
  background: rgba(251, 247, 238, 0.98);
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

.next {
  position: relative;
  display: grid;
  place-items: center;
  height: 56px;
  border: none;
  border-radius: 16px;
  background: #2f7d57;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(47, 125, 87, 0.28);
  transition:
    transform 0.2s var(--ease-out),
    background-color 0.25s ease,
    box-shadow 0.25s ease,
    opacity 0.25s ease;
}

.next:hover:not(:disabled) {
  background: #266a49;
  transform: translateY(-2px);
}

.next:active:not(:disabled) {
  transform: scale(0.98);
}

.next:hover:not(:disabled) .next__shine {
  transform: translateX(120%) skewX(-20deg);
}

.next:disabled {
  background: #a9b8ae;
  box-shadow: none;
  cursor: not-allowed;
}

.next--sending:disabled {
  background: #2f7d57;
  cursor: progress;
}

.next__shine {
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  transform: translateX(-160%) skewX(-20deg);
  transition: transform 0.7s var(--ease-out);
  pointer-events: none;
}

.next__content {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.next__content svg {
  width: 20px;
  height: 20px;
  transition: transform 0.2s ease;
}

.next:hover:not(:disabled) .next__content svg {
  transform: translateX(4px);
}

.next__spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(251, 247, 238, 0.35);
  border-top-color: #fbf7ee;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.sheet-enter-active {
  transition:
    transform 0.55s var(--ease-out),
    opacity 0.35s ease;
}

.sheet-leave-active {
  transition:
    transform 0.35s ease,
    opacity 0.25s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.alert-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.35s var(--ease-out);
}

.alert-leave-active {
  transition: opacity 0.15s ease;
}

.alert-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.alert-leave-to {
  opacity: 0;
}

@keyframes item-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.5);
  }
  70% {
    box-shadow: 0 0 0 7px rgba(47, 125, 87, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 86dvh;
    border-radius: 28px 28px 0 0;
    border-bottom: none;
  }

  .sheet__grip {
    display: block;
    width: 44px;
    height: 5px;
    margin: 10px auto 0;
    border-radius: 999px;
    background: #ddd4c1;
  }

  .sheet__head {
    padding: 14px 18px 4px;
  }

  .sheet__title {
    font-size: 21px;
  }

  .sheet__scroll {
    padding: 4px 18px 12px;
  }

  .sheet__foot {
    padding: 12px 18px calc(16px + env(safe-area-inset-bottom));
  }

  .tariffs {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 8px;
  }

  .tariff {
    min-height: 118px;
    padding: 12px 10px 10px;
  }

  .tariff__text {
    display: none;
  }

  .sheet-enter-from,
  .sheet-leave-to {
    opacity: 1;
    transform: translateY(100%);
  }
}

@media (hover: none) {
  .tariff:hover,
  .link-btn:hover,
  .next:hover:not(:disabled) {
    transform: none;
  }

  .next:hover:not(:disabled) {
    background: #2f7d57;
  }

  .route__swap:hover {
    transform: translateY(-50%);
  }
}
</style>
