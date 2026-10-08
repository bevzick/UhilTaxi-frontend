<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AddressInput from '@/components/AddressInput.vue'
import { ApiError } from '@/api/http'
import { COMMENT_MAX, ordersApi, prepareOrder } from '@/api/orders'
import { useAuth } from '@/composables/useAuth'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { MAX_PASSENGERS, SEATS, type CarClass, type CarType, type OrderExtras } from '@/types/order'
import type { Place } from '@/types/geo'

const props = defineProps<{
  open: boolean
  pickup: Place | null
  destination: Place | null
  myPlace: Place | null
}>()

const emit = defineEmits<{
  close: []
  done: []
  'update:pickup': [value: Place | null]
  'update:destination': [value: Place | null]
}>()

const router = useRouter()
const { token, logout } = useAuth()

const classes: { id: CarClass; name: string; text: string }[] = [
  { id: 'economy', name: 'Economy', text: 'Щоденні поїздки' },
  { id: 'comfort', name: 'Comfort', text: 'Більше простору' },
  { id: 'business', name: 'Business', text: 'Преміум авто' },
]

const types: { id: CarType; name: string }[] = [
  { id: 'sedan', name: 'Седан' },
  { id: 'wagon', name: 'Універсал' },
  { id: 'minivan', name: 'Мінівен' },
  { id: 'electric', name: 'Електро' },
]

const extrasList: { id: keyof OrderExtras; name: string }[] = [
  { id: 'child_seat', name: 'Дитяче крісло' },
  { id: 'pets', name: 'З твариною' },
  { id: 'luggage', name: 'Великий багаж' },
]

const carClass = ref<CarClass>('comfort')
const carType = ref<CarType>('sedan')
const passengers = ref(1)
const extras = reactive<OrderExtras>({ child_seat: false, pets: false, luggage: false })
const comment = ref('')
const state = ref<'form' | 'sending' | 'success'>('form')
const error = ref('')
const orderId = ref('')
const openCount = ref(0)
const passengerDir = ref<'up' | 'down'>('up')
const autoSwitched = ref(false)

const pickupModel = computed({
  get: () => props.pickup,
  set: (value) => emit('update:pickup', value),
})

const destinationModel = computed({
  get: () => props.destination,
  set: (value) => emit('update:destination', value),
})

const distance = computed(() => {
  if (!props.pickup || !props.destination || props.pickup.pending || props.destination.pending) return null
  return distanceMeters(props.pickup, props.destination)
})

const canSubmit = computed(
  () =>
    state.value === 'form' &&
    !!props.pickup &&
    !!props.destination &&
    !props.pickup.pending &&
    !props.destination.pending,
)

const canUseMe = computed(() => !!props.myPlace && props.pickup?.source !== 'me')

watch(
  () => props.open,
  (open) => {
    if (open) {
      openCount.value++
      if (state.value === 'success') reset()
    }
  },
)

watch(passengers, (count, previous) => {
  passengerDir.value = count > previous ? 'up' : 'down'
  if (count > SEATS[carType.value]) {
    carType.value = 'minivan'
    autoSwitched.value = true
  }
})

watch(carType, () => {
  if (carType.value !== 'minivan') autoSwitched.value = false
})

watch(
  () => [props.pickup, props.destination],
  () => {
    if (error.value) error.value = ''
  },
)

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && state.value !== 'sending') emit('close')
}

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function changePassengers(delta: number) {
  passengers.value = Math.min(MAX_PASSENGERS, Math.max(1, passengers.value + delta))
}

function selectType(type: CarType) {
  if (SEATS[type] < passengers.value) return
  carType.value = type
}

function swap() {
  const from = props.pickup
  emit('update:pickup', props.destination)
  emit('update:destination', from)
}

function useMe() {
  if (props.myPlace) emit('update:pickup', { ...props.myPlace })
}

function reset() {
  state.value = 'form'
  error.value = ''
  orderId.value = ''
  comment.value = ''
}

function safeId(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return ''
  const id = String(value)
  return id.length <= 24 && /^[\w-]+$/.test(id) ? id : ''
}

async function submit() {
  if (!canSubmit.value) return
  error.value = ''

  const prepared = prepareOrder({
    pickup: props.pickup,
    destination: props.destination,
    passengers: passengers.value,
    carClass: carClass.value,
    carType: carType.value,
    extras: { ...extras },
    comment: comment.value,
  })

  if ('error' in prepared) {
    error.value = prepared.error
    return
  }

  state.value = 'sending'

  try {
    const response = await ordersApi.create(prepared.data, token.value)
    orderId.value = safeId(response?.id)
    state.value = 'success'
  } catch (e) {
    state.value = 'form'
    if (e instanceof ApiError && e.status === 401) {
      logout()
      await router.replace({ name: 'auth', query: { redirect: '/app' } })
      return
    }
    error.value = e instanceof ApiError ? e.message : 'Не вдалося створити замовлення. Спробуйте ще раз'
  }
}

function finish() {
  reset()
  emit('done')
}
</script>

<template>
  <Transition name="sheet">
    <aside v-show="open" class="sheet" :class="{ 'sheet--success': state === 'success' }" aria-label="Нове замовлення">
      <div class="sheet__grip" aria-hidden="true"></div>

      <Transition name="fade" mode="out-in">
        <div v-if="state !== 'success'" :key="`form-${openCount}`" class="sheet__inner">
          <header class="sheet__head item" style="--i: 0">
            <div>
              <h2 class="sheet__title">Нове замовлення</h2>
              <p class="sheet__sub">Оберіть маршрут і авто</p>
            </div>
            <button type="button" class="icon-btn" aria-label="Закрити" :disabled="state === 'sending'" @click="emit('close')">
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
                <AddressInput
                  v-model="pickupModel"
                  input-id="order-from"
                  variant="from"
                  label="Звідки"
                  placeholder="Адреса посадки"
                />
                <button type="button" class="route__swap" aria-label="Поміняти місцями" @click="swap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                  </svg>
                </button>
                <AddressInput
                  v-model="destinationModel"
                  input-id="order-to"
                  variant="to"
                  label="Куди"
                  placeholder="Куди їдемо?"
                />
              </div>

              <Transition name="fade">
                <p v-if="distance !== null" class="route__meta">
                  <span class="route__dot"></span>
                  ≈ {{ formatDistance(distance) }} по прямій
                </p>
              </Transition>
            </section>

            <section class="block item" style="--i: 2">
              <h3 class="block__title">Клас авто</h3>
              <div class="classes">
                <button
                  v-for="item in classes"
                  :key="item.id"
                  type="button"
                  class="class-card"
                  :class="{ 'class-card--active': carClass === item.id }"
                  :aria-pressed="carClass === item.id"
                  @click="carClass = item.id"
                >
                  <svg class="class-card__icon" viewBox="0 0 48 24" aria-hidden="true">
                    <path
                      d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linejoin="round"
                    />
                    <circle cx="14" cy="18" r="3.2" fill="currentColor" />
                    <circle cx="35" cy="18" r="3.2" fill="currentColor" />
                    <path v-if="item.id !== 'economy'" d="M14 8h7v4.5h-9z" fill="currentColor" opacity="0.35" />
                    <path v-if="item.id === 'business'" d="M24 8h8l4 4.5H24z" fill="currentColor" opacity="0.35" />
                  </svg>
                  <span class="class-card__name">{{ item.name }}</span>
                  <span class="class-card__text">{{ item.text }}</span>
                  <span class="class-card__check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                </button>
              </div>
            </section>

            <section class="block item" style="--i: 3">
              <div class="block__head">
                <h3 class="block__title">Тип авто</h3>
                <Transition name="fade">
                  <span v-if="autoSwitched" class="block__hint">Для {{ passengers }} пасажирів — мінівен</span>
                </Transition>
              </div>
              <div class="segments" role="radiogroup">
                <button
                  v-for="item in types"
                  :key="item.id"
                  type="button"
                  role="radio"
                  class="segment"
                  :class="{ 'segment--active': carType === item.id }"
                  :aria-checked="carType === item.id"
                  :disabled="SEATS[item.id] < passengers"
                  @click="selectType(item.id)"
                >
                  {{ item.name }}
                </button>
              </div>
            </section>

            <section class="block block--row item" style="--i: 4">
              <div>
                <h3 class="block__title">Пасажири</h3>
                <p class="block__text">До {{ SEATS[carType] }} у цьому авто</p>
              </div>
              <div class="stepper">
                <button
                  type="button"
                  class="stepper__btn"
                  aria-label="Менше пасажирів"
                  :disabled="passengers <= 1"
                  @click="changePassengers(-1)"
                >
                  −
                </button>
                <span class="stepper__value" aria-live="polite">
                  <Transition :name="`num-${passengerDir}`" mode="out-in">
                    <span :key="passengers">{{ passengers }}</span>
                  </Transition>
                </span>
                <button
                  type="button"
                  class="stepper__btn"
                  aria-label="Більше пасажирів"
                  :disabled="passengers >= MAX_PASSENGERS"
                  @click="changePassengers(1)"
                >
                  +
                </button>
              </div>
            </section>

            <section class="block item" style="--i: 5">
              <h3 class="block__title">Додатково</h3>
              <div class="chips">
                <button
                  v-for="item in extrasList"
                  :key="item.id"
                  type="button"
                  class="chip"
                  :class="{ 'chip--active': extras[item.id] }"
                  :aria-pressed="extras[item.id]"
                  @click="extras[item.id] = !extras[item.id]"
                >
                  <span class="chip__tick" aria-hidden="true"></span>
                  {{ item.name }}
                </button>
              </div>
            </section>

            <section class="block item" style="--i: 6">
              <label class="block__title" for="order-comment">Коментар водію</label>
              <div class="comment">
                <textarea
                  id="order-comment"
                  v-model="comment"
                  class="comment__input"
                  rows="2"
                  :maxlength="COMMENT_MAX"
                  placeholder="Під'їзд, поверх, побажання…"
                  spellcheck="true"
                ></textarea>
                <span class="comment__count">{{ comment.length }}/{{ COMMENT_MAX }}</span>
              </div>
            </section>
          </div>

          <footer class="sheet__foot item" style="--i: 7">
            <Transition name="alert">
              <p v-if="error" class="alert" role="alert">{{ error }}</p>
            </Transition>
            <button type="button" class="next" :disabled="!canSubmit" :class="{ 'next--sending': state === 'sending' }" @click="submit">
              <span class="next__shine"></span>
              <Transition name="fade" mode="out-in">
                <span v-if="state === 'sending'" key="sending" class="next__content">
                  <span class="next__spinner"></span>
                  Надсилаємо…
                </span>
                <span v-else key="idle" class="next__content">
                  Далі
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Transition>
            </button>
          </footer>
        </div>

        <div v-else key="success" class="success">
          <div class="radar" aria-hidden="true">
            <span class="radar__ring"></span>
            <span class="radar__ring"></span>
            <span class="radar__ring"></span>
            <span class="radar__core">
              <svg viewBox="0 0 48 24">
                <path d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" />
                <circle cx="14" cy="18" r="3.2" fill="currentColor" />
                <circle cx="35" cy="18" r="3.2" fill="currentColor" />
              </svg>
            </span>
          </div>
          <h2 class="success__title">Шукаємо водія</h2>
          <p class="success__text">Замовлення прийнято. Щойно водій погодиться, ви побачите його тут.</p>
          <p v-if="orderId" class="success__id">Замовлення № {{ orderId }}</p>
          <button type="button" class="next next--light" @click="finish">Готово</button>
        </div>
      </Transition>
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

.block--row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
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

.block--row .block__title {
  margin-bottom: 2px;
}

.block__text {
  margin: 0;
  font-size: 13px;
  color: #8a8578;
}

.block__hint {
  font-size: 12.5px;
  font-weight: 500;
  color: #2f7d57;
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
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 4px, transparent 4px 8px);
  z-index: 1;
  pointer-events: none;
}

.route__swap {
  position: absolute;
  top: 50%;
  right: 12px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
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
  width: 16px;
  height: 16px;
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

.classes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.class-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 14px 12px 12px;
  border: 1.5px solid #e6dfcf;
  border-radius: 16px;
  background: #fffdf8;
  color: #8a8578;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.25s var(--ease-out),
    box-shadow 0.25s ease;
}

.class-card:hover {
  transform: translateY(-2px);
  border-color: #d6cdb8;
}

.class-card--active {
  border-color: #2f7d57;
  background: #ffffff;
  color: #2f7d57;
  box-shadow: 0 10px 24px rgba(47, 125, 87, 0.14);
}

.class-card__icon {
  width: 46px;
  height: 24px;
  margin-bottom: 8px;
  transition: transform 0.35s var(--ease-out);
}

.class-card--active .class-card__icon {
  transform: translateX(4px);
}

.class-card__name {
  font-size: 14px;
  font-weight: 700;
  color: #2b2b26;
}

.class-card__text {
  font-size: 11.5px;
  line-height: 1.35;
  color: #8a8578;
}

.class-card__check {
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

.class-card__check svg {
  width: 12px;
  height: 12px;
}

.class-card--active .class-card__check {
  opacity: 1;
  transform: scale(1);
}

.segments {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: #f1ebdd;
}

.segment {
  padding: 10px 4px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #6b675c;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.25s ease,
    color 0.2s ease,
    box-shadow 0.25s ease,
    transform 0.15s ease;
}

.segment:active:not(:disabled) {
  transform: scale(0.95);
}

.segment--active {
  background: #fffdf8;
  color: #2b2b26;
  box-shadow: 0 4px 12px rgba(60, 50, 30, 0.1);
}

.segment:disabled {
  color: #c4bcaa;
  cursor: not-allowed;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: #f1ebdd;
}

.stepper__btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: #fffdf8;
  color: #2b2b26;
  font-family: inherit;
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    opacity 0.2s ease;
}

.stepper__btn:active:not(:disabled) {
  transform: scale(0.9);
}

.stepper__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stepper__value {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  color: #2b2b26;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1.5px solid #e6dfcf;
  border-radius: 999px;
  background: #fffdf8;
  color: #4a473f;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.15s ease;
}

.chip:active {
  transform: scale(0.96);
}

.chip__tick {
  position: relative;
  width: 16px;
  height: 16px;
  border: 1.5px solid #cfc6b2;
  border-radius: 5px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.chip__tick::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4.5px;
  width: 4px;
  height: 8px;
  border: solid #ffffff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) scale(0);
  transition: transform 0.25s cubic-bezier(0.34, 1.6, 0.5, 1);
}

.chip--active {
  border-color: #2f7d57;
  background: #e3efe7;
  color: #2f7d57;
}

.chip--active .chip__tick {
  border-color: #2f7d57;
  background: #2f7d57;
}

.chip--active .chip__tick::after {
  transform: rotate(45deg) scale(1);
}

.comment {
  position: relative;
}

.comment__input {
  width: 100%;
  min-height: 64px;
  padding: 12px 14px 24px;
  border: 1.5px solid #e6dfcf;
  border-radius: 14px;
  background: #fffdf8;
  color: #2b2b26;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease;
}

.comment__input::placeholder {
  color: #b5ae9f;
}

.comment__input:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 4px rgba(47, 125, 87, 0.12);
}

.comment__count {
  position: absolute;
  right: 12px;
  bottom: 8px;
  font-size: 11.5px;
  color: #b5ae9f;
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

.next--light {
  width: 100%;
  margin-top: 8px;
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
  gap: 10px;
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

.success {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 32px;
  text-align: center;
}

.radar {
  position: relative;
  display: grid;
  place-items: center;
  width: 180px;
  height: 180px;
  margin-bottom: 28px;
}

.radar__ring {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(47, 125, 87, 0.35);
  border-radius: 50%;
  animation: radar 2.4s ease-out infinite;
}

.radar__ring:nth-child(2) {
  animation-delay: 0.8s;
}

.radar__ring:nth-child(3) {
  animation-delay: 1.6s;
}

.radar__core {
  position: relative;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 16px 40px rgba(47, 125, 87, 0.4);
  animation: core-in 0.7s cubic-bezier(0.34, 1.5, 0.5, 1) backwards;
}

.radar__core svg {
  width: 44px;
  height: 24px;
  animation: drive 1.6s ease-in-out infinite;
}

.success__title {
  margin: 0 0 10px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2b2b26;
  animation: item-in 0.5s 0.2s var(--ease-out) backwards;
}

.success__text {
  max-width: 300px;
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.6;
  color: #6b675c;
  animation: item-in 0.5s 0.3s var(--ease-out) backwards;
}

.success__id {
  margin: 0 0 20px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #e3efe7;
  color: #2f7d57;
  font-size: 13px;
  font-weight: 600;
  animation: item-in 0.5s 0.38s var(--ease-out) backwards;
}

.success .next {
  animation: item-in 0.5s 0.45s var(--ease-out) backwards;
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

.num-up-enter-active,
.num-up-leave-active,
.num-down-enter-active,
.num-down-leave-active {
  transition:
    transform 0.18s var(--ease-out),
    opacity 0.18s ease;
}

.num-up-enter-from,
.num-down-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.num-up-leave-to,
.num-down-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}

@keyframes item-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes radar {
  from {
    opacity: 1;
    transform: scale(0.45);
  }
  to {
    opacity: 0;
    transform: scale(1.15);
  }
}

@keyframes core-in {
  from {
    opacity: 0;
    transform: scale(0.3);
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

  .classes {
    gap: 8px;
  }

  .class-card {
    padding: 12px 10px 10px;
  }

  .class-card__text {
    display: none;
  }

  .segment {
    font-size: 12.5px;
  }

  .success {
    min-height: 420px;
    padding: 32px 24px calc(24px + env(safe-area-inset-bottom));
  }

  .sheet-enter-from,
  .sheet-leave-to {
    opacity: 1;
    transform: translateY(100%);
  }
}

@media (hover: none) {
  .class-card:hover,
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

  .route__swap:active {
    transform: translateY(-50%) rotate(180deg);
  }
}
</style>