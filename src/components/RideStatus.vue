<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { STAGE_LABEL, formatFare, formatKm, fullName, initials } from '@/utils/order'
import type { OrderStage, OrderView } from '@/types/order'

const props = defineProps<{
  order: OrderView
  confirmed: boolean
  needsDecision: boolean
  busy: boolean
  error: string
  researching: boolean
}>()

const emit = defineEmits<{ confirm: []; reject: []; cancel: []; done: [] }>()

const STEPS: { stage: OrderStage; label: string }[] = [
  { stage: 'searching', label: 'Пошук' },
  { stage: 'accepted', label: 'Їде до вас' },
  { stage: 'arrived', label: 'На місці' },
  { stage: 'started', label: 'У дорозі' },
  { stage: 'completed', label: 'Готово' },
]

const askCancel = ref(false)
const stage = computed(() => props.order.stage)
const stepIndex = computed(() => STEPS.findIndex((step) => step.stage === stage.value))
const driver = computed(() => props.order.driver)
const driverName = computed(() => fullName(driver.value) || (props.order.driverId ? `Водій №${props.order.driverId}` : 'Водій'))
const canCancel = computed(() => ['searching', 'accepted', 'arrived'].includes(stage.value))
const showDriver = computed(() => ['accepted', 'arrived', 'started'].includes(stage.value))
const phoneHref = computed(() => (driver.value?.phone ? `tel:${driver.value.phone.replace(/[^\d+]/g, '')}` : ''))
const stars = computed(() => {
  const rating = driver.value?.rating
  return rating === null || rating === undefined ? null : Math.max(0, Math.min(5, rating))
})

const title = computed(() => {
  if (stage.value === 'searching') return props.researching ? 'Шукаємо іншого водія' : STAGE_LABEL.searching
  if (props.needsDecision) return 'Водія знайдено!'
  if (stage.value === 'completed') return 'Приїхали!'
  return STAGE_LABEL[stage.value]
})

const subtitle = computed(() => {
  switch (stage.value) {
    case 'searching':
      return 'Надсилаємо замовлення водіям поруч. Зазвичай це до хвилини'
    case 'accepted':
      return props.needsDecision ? 'Перевірте водія і підтвердіть поїздку' : 'Водій прямує до точки посадки'
    case 'arrived':
      return 'Водій чекає на вас біля точки посадки'
    case 'started':
      return 'Гарної поїздки! Пристебніться'
    case 'completed':
      return 'Дякуємо, що обрали UhilTaxi'
    default:
      return props.order.cancellationReason || 'Замовлення скасовано'
  }
})

watch(stage, () => (askCancel.value = false))

function onCancel() {
  if (!askCancel.value) {
    askCancel.value = true
    return
  }
  askCancel.value = false
  emit('cancel')
}
</script>

<template>
  <section class="ride" :class="`ride--${stage}`" aria-live="polite" aria-label="Статус поїздки">
    <header class="ride__head">
      <div class="ride__titles">
        <Transition name="swap" mode="out-in">
          <h2 :key="title" class="ride__title">{{ title }}</h2>
        </Transition>
        <p class="ride__sub">{{ subtitle }}</p>
      </div>
      <span class="ride__id">№ {{ order.id }}</span>
    </header>

    <ol v-if="stage !== 'cancelled'" class="steps" aria-label="Етапи поїздки">
      <li
        v-for="(step, index) in STEPS"
        :key="step.stage"
        class="steps__item"
        :class="{ 'steps__item--done': index < stepIndex, 'steps__item--now': index === stepIndex }"
      >
        <span class="steps__bar"></span>
        <span class="steps__label">{{ step.label }}</span>
      </li>
    </ol>

    <Transition name="swap" mode="out-in">
      <div v-if="stage === 'searching'" key="search" class="radar" aria-hidden="true">
        <span class="radar__ring"></span>
        <span class="radar__ring"></span>
        <span class="radar__ring"></span>
        <span class="radar__sweep"></span>
        <span class="radar__core">
          <svg viewBox="0 0 48 24">
            <path d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" />
            <circle cx="14" cy="18" r="3.2" fill="currentColor" />
            <circle cx="35" cy="18" r="3.2" fill="currentColor" />
          </svg>
        </span>
      </div>

      <div v-else-if="showDriver" key="driver" class="driver" :class="{ 'driver--decide': needsDecision }">
        <div class="driver__top">
          <span class="driver__avatar">
            {{ initials(driver, 'В') }}
            <span v-if="confirmed || stage !== 'accepted'" class="driver__badge" aria-label="Підтверджено">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          </span>
          <div class="driver__info">
            <p class="driver__name">{{ driverName }}</p>
            <p v-if="stars !== null" class="driver__rating">
              <span class="driver__stars" :style="{ '--rating': stars }" aria-hidden="true">★★★★★</span>
              <strong>{{ stars.toFixed(2).replace('.', ',') }}</strong>
              <span v-if="driver?.ratingCount">· {{ driver.ratingCount }} поїздок</span>
            </p>
            <p v-else class="driver__rating">Новий водій UhilTaxi</p>
          </div>
          <a v-if="phoneHref" class="driver__call" :href="phoneHref" aria-label="Подзвонити водію">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path
                d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
              />
            </svg>
          </a>
        </div>

        <div v-if="driver?.car || driver?.plate" class="driver__car">
          <svg class="driver__car-icon" viewBox="0 0 48 24" aria-hidden="true">
            <path d="M6 17v-4.5l5-6.5h22l7 6.5 3 1.5V17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
            <circle cx="14" cy="18" r="3.2" fill="currentColor" />
            <circle cx="35" cy="18" r="3.2" fill="currentColor" />
          </svg>
          <span class="driver__model">{{ driver?.car || 'Авто' }}</span>
          <span v-if="driver?.plate" class="plate">
            <span class="plate__flag" aria-hidden="true"><span></span><span></span></span>
            {{ driver.plate }}
          </span>
        </div>

        <Transition name="swap">
          <div v-if="needsDecision" class="decide">
            <button type="button" class="btn btn--primary" :disabled="busy" @click="emit('confirm')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Підтвердити
            </button>
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="emit('reject')">
              <span v-if="busy" class="spinner spinner--dark"></span>
              <template v-else>Шукати іншого</template>
            </button>
          </div>
        </Transition>
      </div>

      <div v-else-if="stage === 'completed'" key="done" class="final">
        <span class="final__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <p class="final__fare">{{ formatFare(order.fare) }}</p>
        <p class="final__label">до сплати водію</p>
      </div>

      <div v-else key="cancel" class="final final--cancel">
        <span class="final__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </span>
      </div>
    </Transition>

    <div class="trip">
      <div class="trip__route">
        <p class="trip__point trip__point--from">{{ order.pickup.address }}</p>
        <p class="trip__point trip__point--to">{{ order.destination.address }}</p>
      </div>
      <div class="trip__meta">
        <span><strong>{{ formatFare(order.fare) }}</strong></span>
        <span v-if="order.distanceKm !== null">{{ formatKm(order.distanceKm) }}</span>
        <span v-if="order.durationMin !== null">≈ {{ order.durationMin }} хв</span>
      </div>
    </div>

    <Transition name="swap">
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </Transition>

    <footer class="ride__foot">
      <button v-if="canCancel" type="button" class="link" :class="{ 'link--danger': askCancel }" :disabled="busy" @click="onCancel">
        {{ askCancel ? 'Натисніть ще раз, щоб скасувати' : 'Скасувати замовлення' }}
      </button>
      <button v-else-if="stage === 'completed' || stage === 'cancelled'" type="button" class="btn btn--primary btn--wide" @click="emit('done')">
        {{ stage === 'completed' ? 'Готово' : 'Нове замовлення' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.ride {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px 18px;
  border: 1px solid rgba(236, 229, 214, 0.9);
  border-radius: 26px;
  background: rgba(255, 253, 248, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 24px 60px rgba(40, 35, 20, 0.18);
  animation: rise 0.6s var(--ease-out) backwards;
}

.ride__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.ride__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2b2b26;
}

.ride__sub {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.45;
  color: #6b675c;
}

.ride__id {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f1ebdd;
  color: #6b675c;
  font-size: 12px;
  font-weight: 600;
}

.steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.steps__bar {
  display: block;
  height: 5px;
  border-radius: 999px;
  background: #ece5d6;
  overflow: hidden;
  position: relative;
}

.steps__bar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: #2f7d57;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.6s var(--ease-out);
}

.steps__item--done .steps__bar::after {
  transform: scaleX(1);
}

.steps__item--now .steps__bar::after {
  transform: scaleX(1);
  background: linear-gradient(90deg, #2f7d57 0%, #8fd1ab 50%, #2f7d57 100%);
  background-size: 200% 100%;
  animation: flow 1.4s linear infinite;
}

.steps__label {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #b5ae9f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.steps__item--done .steps__label,
.steps__item--now .steps__label {
  color: #2f7d57;
}

.radar {
  position: relative;
  display: grid;
  place-items: center;
  width: 150px;
  height: 150px;
  margin: 4px auto;
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

.radar__sweep {
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(47, 125, 87, 0.28), rgba(47, 125, 87, 0) 28%);
  animation: spin 2.2s linear infinite;
}

.radar__core {
  position: relative;
  display: grid;
  place-items: center;
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 14px 34px rgba(47, 125, 87, 0.4);
}

.radar__core svg {
  width: 38px;
  height: 20px;
  animation: drive 1.6s ease-in-out infinite;
}

.driver {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1.5px solid #ece5d6;
  border-radius: 20px;
  background: #ffffff;
  transition:
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.driver--decide {
  border-color: #2f7d57;
  box-shadow: 0 0 0 5px rgba(47, 125, 87, 0.1);
  animation: found 0.7s cubic-bezier(0.34, 1.5, 0.5, 1) backwards;
}

.driver__top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.driver__avatar {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: linear-gradient(135deg, #2f7d57, #5aa57d);
  color: #fbf7ee;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.driver__badge {
  position: absolute;
  right: -5px;
  bottom: -5px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 2.5px solid #ffffff;
  border-radius: 50%;
  background: #2f7d57;
  color: #ffffff;
  animation: pop 0.45s cubic-bezier(0.34, 1.6, 0.5, 1) backwards;
}

.driver__badge svg {
  width: 11px;
  height: 11px;
}

.driver__info {
  flex: 1;
  min-width: 0;
}

.driver__name {
  margin: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  color: #2b2b26;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.driver__rating {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3px 0 0;
  font-size: 13px;
  color: #8a8578;
}

.driver__rating strong {
  color: #2b2b26;
}

.driver__stars {
  --rating: 5;
  font-size: 13px;
  letter-spacing: 1px;
  background: linear-gradient(90deg, #e0a526 calc(var(--rating) / 5 * 100%), #e6dfcf 0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.driver__call {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #e3efe7;
  color: #2f7d57;
  transition: transform 0.2s var(--ease-out);
}

.driver__call:hover {
  transform: scale(1.06);
}

.driver__call svg {
  width: 20px;
  height: 20px;
}

.driver__car {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #f8f4ea;
}

.driver__car-icon {
  flex-shrink: 0;
  width: 34px;
  height: 18px;
  color: #6b675c;
}

.driver__model {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: #2b2b26;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.plate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 3px 8px 3px 4px;
  border: 1.5px solid #2b2b26;
  border-radius: 6px;
  background: #ffffff;
  color: #2b2b26;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}

.plate__flag {
  display: flex;
  flex-direction: column;
  width: 10px;
  height: 14px;
  overflow: hidden;
  border-radius: 2px;
}

.plate__flag span {
  flex: 1;
  background: #2a64c5;
}

.plate__flag span + span {
  background: #f5cd2f;
}

.decide {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 8px;
}

.final {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
}

.final__icon {
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

.final--cancel .final__icon {
  background: #e9e2d2;
  color: #8a8578;
  box-shadow: none;
}

.final__icon svg {
  width: 32px;
  height: 32px;
}

.final__fare {
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #2b2b26;
}

.final__label {
  margin: 2px 0 0;
  font-size: 13px;
  color: #8a8578;
}

.trip {
  padding: 14px;
  border-radius: 18px;
  background: #f8f4ea;
}

.trip__route {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 22px;
}

.trip__route::before {
  content: '';
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 5px;
  width: 2px;
  background: repeating-linear-gradient(#cfc6b2 0 3px, transparent 3px 6px);
}

.trip__point {
  position: relative;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  color: #2b2b26;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trip__point::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -22px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transform: translateY(-50%);
}

.trip__point--from::before {
  border: 3.5px solid #2f7d57;
  background: #ffffff;
}

.trip__point--to::before {
  border-radius: 3px;
  background: #2b2b26;
  transform: translateY(-50%) rotate(45deg) scale(0.85);
}

.trip__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e0d8c6;
  font-size: 13px;
  color: #6b675c;
}

.trip__meta strong {
  font-size: 15px;
  color: #2b2b26;
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

.ride__foot {
  display: flex;
  justify-content: center;
}

.ride__foot:empty {
  display: none;
}

.btn {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  height: 50px;
  padding: 0 16px;
  border-radius: 15px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.2s var(--ease-out),
    background-color 0.2s ease,
    border-color 0.2s ease,
    opacity 0.2s ease;
}

.btn:active:not(:disabled) {
  transform: scale(0.97);
}

.btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.btn svg {
  width: 18px;
  height: 18px;
}

.btn--primary {
  border: none;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 10px 26px rgba(47, 125, 87, 0.3);
}

.btn--primary:hover:not(:disabled) {
  background: #266a49;
}

.btn--ghost {
  border: 1.5px solid #e6dfcf;
  background: #fffdf8;
  color: #4a473f;
}

.btn--ghost:hover:not(:disabled) {
  border-color: #c2543f;
  color: #9f3a28;
}

.btn--wide {
  width: 100%;
}

.link {
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #8a8578;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.link:hover:not(:disabled),
.link--danger {
  background: #fbeae6;
  color: #9f3a28;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(43, 43, 38, 0.15);
  border-top-color: #2b2b26;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.swap-enter-active,
.swap-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.3s var(--ease-out);
}

.swap-enter-from,
.swap-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
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

@keyframes spin {
  to {
    transform: rotate(360deg);
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

@keyframes flow {
  to {
    background-position: -200% 0;
  }
}

@keyframes found {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.3);
  }
}

@media (max-width: 720px) {
  .ride {
    gap: 12px;
    padding: 16px 14px calc(14px + env(safe-area-inset-bottom));
    border-radius: 24px;
  }

  .ride__title {
    font-size: 20px;
  }

  .ride__sub {
    font-size: 13px;
  }

  .radar {
    width: 110px;
    height: 110px;
  }

  .radar__core {
    width: 56px;
    height: 56px;
  }

  .steps__label {
    font-size: 10px;
  }

  .decide {
    grid-template-columns: 1fr 1fr;
  }

  .decide .btn {
    padding: 0 10px;
    font-size: 14px;
    white-space: nowrap;
  }
}

@media (hover: none) {
  .link:hover:not(:disabled):not(.link--danger) {
    background: transparent;
    color: #8a8578;
  }

  .btn--ghost:hover:not(:disabled) {
    border-color: #e6dfcf;
    color: #4a473f;
  }
}

@media (prefers-reduced-motion: reduce) {
  .radar__ring,
  .radar__sweep,
  .radar__core svg,
  .steps__item--now .steps__bar::after {
    animation: none;
  }
}
</style>
