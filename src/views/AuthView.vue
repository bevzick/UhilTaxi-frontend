<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { useAuth } from '@/composables/useAuth'
import {
  LIMITS,
  filterPhoneInput,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  passwordChecks,
  safeRedirect,
  validateBirthDate,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
  type ValidationResult,
} from '@/utils/validation'

type Mode = 'login' | 'register'
type FieldKey = 'first_name' | 'last_name' | 'phone' | 'email' | 'password' | 'birth_date'
type PhoneTarget = 'login' | 'register'

const MAX_FAILS = 5
const LOCK_BASE_MS = 30_000
const MIN_INTERVAL_MS = 800

const route = useRoute()
const router = useRouter()
const { login, register } = useAuth()

const toMode = (value: unknown): Mode => (value === 'register' ? 'register' : 'login')

const mode = ref<Mode>(toMode(route.query.mode))
const loading = ref(false)
const success = ref(false)
const shaking = ref(false)
const intro = ref(true)
const error = ref('')
const notice = ref('')
const showPassword = ref(false)
const passwordFocused = ref(false)
const errors = reactive<Partial<Record<FieldKey, string>>>({})

const fails = ref(0)
const lockUntil = ref(0)
const now = ref(Date.now())
let lastSubmit = 0
let lockTimer = 0

const loginForm = reactive({ phone: '', password: '' })
const registerForm = reactive({
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  password: '',
  birth_date: '',
})

const redirectTo = computed(() => safeRedirect(route.query.redirect))
const today = new Date().toISOString().slice(0, 10)
const checks = computed(() => passwordChecks(registerForm.password))
const showChecks = computed(() => passwordFocused.value || registerForm.password.length > 0)
const lockSeconds = computed(() => Math.max(0, Math.ceil((lockUntil.value - now.value) / 1000)))
const locked = computed(() => lockSeconds.value > 0)

const copy = computed(() =>
  mode.value === 'login'
    ? { title: 'З поверненням', text: 'Увійдіть, щоб замовити поїздку', submit: 'Увійти' }
    : { title: 'Створіть акаунт', text: 'Кілька секунд — і таксі завжди під рукою', submit: 'Зареєструватись' },
)

const timers: number[] = []
const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))
const wait = (ms: number) => new Promise<void>((resolve) => later(resolve, ms))

onMounted(() => later(() => (intro.value = false), 1400))
onBeforeUnmount(() => {
  timers.forEach((t) => clearTimeout(t))
  clearInterval(lockTimer)
  loginForm.password = ''
  registerForm.password = ''
})

watch(
  () => route.query.mode,
  (value) => {
    mode.value = toMode(value)
  },
)

function startLock() {
  const steps = fails.value - MAX_FAILS
  lockUntil.value = Date.now() + LOCK_BASE_MS * 2 ** Math.min(steps, 4)
  now.value = Date.now()
  clearInterval(lockTimer)
  lockTimer = window.setInterval(() => {
    now.value = Date.now()
    if (now.value >= lockUntil.value) clearInterval(lockTimer)
  }, 1000)
}

function resetMessages() {
  error.value = ''
  notice.value = ''
  ;(Object.keys(errors) as FieldKey[]).forEach((key) => delete errors[key])
}

function setMode(next: Mode) {
  if (next === mode.value || loading.value) return
  resetMessages()
  showPassword.value = false
  loginForm.password = ''
  registerForm.password = ''
  mode.value = next
  router.replace({ query: { ...route.query, mode: next } })
}

function clearError(key: FieldKey) {
  if (errors[key]) delete errors[key]
  if (error.value) error.value = ''
}

function onPhoneInput(target: PhoneTarget) {
  const form = target === 'login' ? loginForm : registerForm
  form.phone = filterPhoneInput(form.phone)
  clearError('phone')
}

function tidy(key: 'first_name' | 'last_name' | 'email') {
  registerForm[key] = key === 'email' ? normalizeEmail(registerForm[key]) : normalizeName(registerForm[key])
}

function shake() {
  shaking.value = false
  requestAnimationFrame(() => {
    shaking.value = true
    later(() => (shaking.value = false), 450)
  })
}

function validate() {
  resetMessages()
  const rules: [FieldKey, ValidationResult][] =
    mode.value === 'login'
      ? [
          ['phone', validatePhone(loginForm.phone)],
          ['password', validatePassword(loginForm.password, false)],
        ]
      : [
          ['first_name', validateName(registerForm.first_name)],
          ['last_name', validateName(registerForm.last_name)],
          ['phone', validatePhone(registerForm.phone)],
          ['email', validateEmail(registerForm.email)],
          ['birth_date', validateBirthDate(registerForm.birth_date)],
          ['password', validatePassword(registerForm.password, true)],
        ]

  for (const [key, message] of rules) if (message) errors[key] = message
  return Object.keys(errors).length === 0
}

async function finish() {
  fails.value = 0
  loginForm.password = ''
  registerForm.password = ''
  success.value = true
  await wait(650)
  await router.replace(redirectTo.value)
}

async function submit() {
  if (loading.value || success.value || locked.value) return
  if (Date.now() - lastSubmit < MIN_INTERVAL_MS) return
  lastSubmit = Date.now()

  if (!validate()) {
    shake()
    return
  }

  loading.value = true

  try {
    if (mode.value === 'login') {
      await login({ phone: normalizePhone(loginForm.phone), password: loginForm.password })
      loading.value = false
      await finish()
      return
    }

    const signedIn = await register({
      first_name: normalizeName(registerForm.first_name),
      last_name: normalizeName(registerForm.last_name),
      phone: normalizePhone(registerForm.phone),
      email: normalizeEmail(registerForm.email) || null,
      password: registerForm.password,
      birth_date: registerForm.birth_date || null,
    })

    loading.value = false

    if (signedIn) {
      await finish()
    } else {
      const phone = registerForm.phone
      setMode('login')
      loginForm.phone = phone
      notice.value = 'Акаунт створено! Тепер увійдіть'
    }
  } catch (e) {
    loading.value = false
    error.value = e instanceof ApiError ? e.message : 'Щось пішло не так. Спробуйте ще раз'

    if (e instanceof ApiError && (e.status === 401 || e.status === 429)) {
      fails.value++
      loginForm.password = ''
      if (fails.value >= MAX_FAILS || e.status === 429) startLock()
    }

    shake()
  }
}
</script>

<template>
  <main class="auth" :class="{ 'auth--intro': intro }">
    <aside class="side">
      <div class="side__glow"></div>

      <RouterLink to="/" class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
      </RouterLink>

      <div class="side__content">
        <h2 class="side__title">
          <span class="line"><span class="line__inner" style="--d: 0.55s">Твоя поїздка</span></span>
          <span class="line">
            <span class="line__inner" style="--d: 0.68s">починається <span class="side__accent">тут</span></span>
          </span>
        </h2>
        <p class="side__text">Один акаунт — і таксі будь-якого класу завжди під рукою.</p>
      </div>

      <svg class="side__route" viewBox="0 0 420 200" aria-hidden="true">
        <defs>
          <mask id="auth-route-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="420" height="200">
            <path
              class="route-draw"
              d="M24 170 C 100 172, 110 96, 190 104 S 320 50, 384 36"
              pathLength="1"
              fill="none"
              stroke="#ffffff"
              stroke-width="8"
              stroke-linecap="round"
            />
          </mask>
        </defs>
        <path
          id="auth-route"
          d="M24 170 C 100 172, 110 96, 190 104 S 320 50, 384 36"
          fill="none"
          stroke="rgba(251, 247, 238, 0.28)"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray="2 12"
          mask="url(#auth-route-mask)"
        />
        <g class="pop pop--start">
          <circle cx="24" cy="170" r="9" fill="#5aae80" />
          <circle cx="24" cy="170" r="4" fill="#1f3d2e" />
        </g>
        <g transform="translate(384 36)">
          <g class="pop pop--pin">
            <circle r="10" fill="#5aae80" opacity="0.25">
              <animate attributeName="r" values="8;22;8" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <path
              d="M0 -30 C -14 -30 -16 -16 -16 -14 C -16 -3 0 8 0 8 C 0 8 16 -3 16 -14 C 16 -16 14 -30 0 -30 Z"
              fill="#fbf7ee"
            />
            <circle cx="0" cy="-15" r="5.5" fill="#1f3d2e" />
          </g>
        </g>
        <g class="route-car">
          <rect x="-13" y="-6" width="26" height="12" rx="4" fill="#5aae80" />
          <rect x="4" y="-4.5" width="6" height="9" rx="1.5" fill="#d7ecdf" />
          <animateMotion
            dur="6s"
            begin="1.6s"
            repeatCount="indefinite"
            rotate="auto"
            keyPoints="0;1;1"
            keyTimes="0;0.8;1"
            calcMode="spline"
            keySplines="0.45 0 0.4 1;0 0 1 1"
          >
            <mpath href="#auth-route" />
          </animateMotion>
        </g>
      </svg>
    </aside>

    <section class="main">
      <div class="panel">
        <div class="switch" :class="`switch--${mode}`" role="tablist">
          <span class="switch__pill"></span>
          <button
            type="button"
            role="tab"
            class="switch__btn"
            :class="{ 'switch__btn--active': mode === 'login' }"
            :aria-selected="mode === 'login'"
            @click="setMode('login')"
          >
            Вхід
          </button>
          <button
            type="button"
            role="tab"
            class="switch__btn"
            :class="{ 'switch__btn--active': mode === 'register' }"
            :aria-selected="mode === 'register'"
            @click="setMode('register')"
          >
            Реєстрація
          </button>
        </div>

        <form class="form" :class="{ 'form--shake': shaking }" novalidate @submit.prevent="submit">
          <Transition name="swap" mode="out-in">
            <div :key="mode" class="form__body">
              <header class="head">
                <h1 class="head__title stagger" style="--i: 0">{{ copy.title }}</h1>
                <p class="head__text stagger" style="--i: 1">{{ copy.text }}</p>
              </header>

              <div v-if="mode === 'login'" class="fields">
                <label class="field stagger" style="--i: 2" :class="{ 'field--error': errors.phone }">
                  <span class="field__label">Телефон</span>
                  <input
                    v-model="loginForm.phone"
                    class="field__input"
                    name="phone"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    placeholder="+380 00 000 00 00"
                    :maxlength="LIMITS.phoneMax"
                    @input="onPhoneInput('login')"
                  />
                  <Transition name="err">
                    <span v-if="errors.phone" class="field__error">{{ errors.phone }}</span>
                  </Transition>
                </label>

                <label class="field stagger" style="--i: 3" :class="{ 'field--error': errors.password }">
                  <span class="field__label">Пароль</span>
                  <span class="field__control">
                    <input
                      v-model="loginForm.password"
                      class="field__input"
                      name="password"
                      :maxlength="LIMITS.passwordMax"
                      autocapitalize="off"
                      spellcheck="false"
                      :type="showPassword ? 'text' : 'password'"
                      autocomplete="current-password"
                      placeholder="Ваш пароль"
                      @input="clearError('password')"
                    />
                    <button
                      type="button"
                      class="field__eye"
                      :class="{ 'field__eye--on': showPassword }"
                      :aria-label="showPassword ? 'Сховати пароль' : 'Показати пароль'"
                      @click.prevent="showPassword = !showPassword"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                        <path class="field__eye-slash" d="M3 3l18 18" pathLength="1" />
                      </svg>
                    </button>
                  </span>
                  <Transition name="err">
                    <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
                  </Transition>
                </label>
              </div>

              <div v-else class="fields">
                <div class="row row--names">
                  <label class="field stagger" style="--i: 2" :class="{ 'field--error': errors.first_name }">
                    <span class="field__label">Ім'я</span>
                    <input
                      v-model="registerForm.first_name"
                      class="field__input"
                      name="first_name"
                      type="text"
                      autocomplete="given-name"
                      autocapitalize="words"
                      spellcheck="false"
                      :maxlength="LIMITS.nameMax"
                      @blur="tidy('first_name')"
                      placeholder="Олександр"
                      @input="clearError('first_name')"
                    />
                    <Transition name="err">
                      <span v-if="errors.first_name" class="field__error">{{ errors.first_name }}</span>
                    </Transition>
                  </label>

                  <label class="field stagger" style="--i: 3" :class="{ 'field--error': errors.last_name }">
                    <span class="field__label">Прізвище</span>
                    <input
                      v-model="registerForm.last_name"
                      class="field__input"
                      name="last_name"
                      type="text"
                      autocomplete="family-name"
                      autocapitalize="words"
                      spellcheck="false"
                      :maxlength="LIMITS.nameMax"
                      @blur="tidy('last_name')"
                      placeholder="Коваленко"
                      @input="clearError('last_name')"
                    />
                    <Transition name="err">
                      <span v-if="errors.last_name" class="field__error">{{ errors.last_name }}</span>
                    </Transition>
                  </label>
                </div>

                <label class="field stagger" style="--i: 4" :class="{ 'field--error': errors.phone }">
                  <span class="field__label">Телефон</span>
                  <input
                    v-model="registerForm.phone"
                    class="field__input"
                    name="phone"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    placeholder="+380 00 000 00 00"
                    :maxlength="LIMITS.phoneMax"
                    @input="onPhoneInput('register')"
                  />
                  <Transition name="err">
                    <span v-if="errors.phone" class="field__error">{{ errors.phone }}</span>
                  </Transition>
                </label>

                <div class="row">
                  <label class="field stagger" style="--i: 5" :class="{ 'field--error': errors.email }">
                    <span class="field__label">Email <em>необов'язково</em></span>
                    <input
                      v-model="registerForm.email"
                      class="field__input"
                      name="email"
                      type="email"
                      autocapitalize="off"
                      spellcheck="false"
                      :maxlength="LIMITS.emailMax"
                      @blur="tidy('email')"
                      inputmode="email"
                      autocomplete="email"
                      placeholder="name@mail.com"
                      @input="clearError('email')"
                    />
                    <Transition name="err">
                      <span v-if="errors.email" class="field__error">{{ errors.email }}</span>
                    </Transition>
                  </label>

                  <label class="field stagger" style="--i: 6" :class="{ 'field--error': errors.birth_date }">
                    <span class="field__label">Дата народження <em>необов'язково</em></span>
                    <input
                      v-model="registerForm.birth_date"
                      class="field__input field__input--date"
                      :class="{ 'field__input--empty': !registerForm.birth_date }"
                      name="birth_date"
                      type="date"
                      min="1900-01-01"
                      :max="today"
                      autocomplete="bday"
                      @input="clearError('birth_date')"
                    />
                    <Transition name="err">
                      <span v-if="errors.birth_date" class="field__error">{{ errors.birth_date }}</span>
                    </Transition>
                  </label>
                </div>

                <label class="field stagger" style="--i: 7" :class="{ 'field--error': errors.password }">
                  <span class="field__label">Пароль</span>
                  <span class="field__control">
                    <input
                      v-model="registerForm.password"
                      class="field__input"
                      name="new-password"
                      :maxlength="LIMITS.passwordMax"
                      autocapitalize="off"
                      spellcheck="false"
                      @focus="passwordFocused = true"
                      @blur="passwordFocused = false"
                      :type="showPassword ? 'text' : 'password'"
                      autocomplete="new-password"
                      placeholder="Придумайте пароль"
                      @input="clearError('password')"
                    />
                    <button
                      type="button"
                      class="field__eye"
                      :class="{ 'field__eye--on': showPassword }"
                      :aria-label="showPassword ? 'Сховати пароль' : 'Показати пароль'"
                      @click.prevent="showPassword = !showPassword"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                        <path class="field__eye-slash" d="M3 3l18 18" pathLength="1" />
                      </svg>
                    </button>
                  </span>
                  <Transition name="err">
                    <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
                  </Transition>
                  <Transition name="err">
                    <ul v-if="showChecks" class="checks" aria-live="polite">
                      <li class="checks__item" :class="{ 'checks__item--ok': checks.length }">
                        Від {{ LIMITS.passwordMin }} символів
                      </li>
                      <li class="checks__item" :class="{ 'checks__item--ok': checks.letter }">Літера</li>
                      <li class="checks__item" :class="{ 'checks__item--ok': checks.digit }">Цифра</li>
                    </ul>
                  </Transition>
                </label>
              </div>
            </div>
          </Transition>

          <Transition name="alert">
            <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
            <p v-else-if="notice" class="alert alert--success" role="status">{{ notice }}</p>
          </Transition>

          <button
            type="submit"
            class="submit"
            :class="{ 'submit--loading': loading, 'submit--success': success }"
            :disabled="loading || success || locked"
          >
            <span class="submit__shine"></span>
            <Transition name="label" mode="out-in">
              <span v-if="success" key="ok" class="submit__content">
                <svg class="submit__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" />
                </svg>
              </span>
              <span v-else-if="locked" key="locked" class="submit__content">
                Спробуйте через {{ lockSeconds }} с
              </span>
              <span v-else-if="loading" key="loading" class="submit__content">
                <span class="submit__spinner"></span>
                Зачекайте…
              </span>
              <span v-else :key="mode" class="submit__content">
                {{ copy.submit }}
                <svg class="submit__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </Transition>
          </button>
        </form>

        <Transition name="label" mode="out-in">
          <p :key="mode" class="foot">
            <template v-if="mode === 'login'">
              Ще немає акаунту?
              <button type="button" class="foot__link" @click="setMode('register')">Зареєструватись</button>
            </template>
            <template v-else>
              Вже маєте акаунт?
              <button type="button" class="foot__link" @click="setMode('login')">Увійти</button>
            </template>
          </p>
        </Transition>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --base: 0s;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
}

.auth--intro {
  --base: 0.45s;
}

.side {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
  padding: 40px 56px 48px;
  background: #1f3d2e;
  color: #fbf7ee;
  overflow: hidden;
  animation: side-in 1s var(--ease-out) backwards;
}

.side::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(251, 247, 238, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(251, 247, 238, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at 30% 60%, black 20%, transparent 70%);
  pointer-events: none;
  animation: fade-in 1.2s 0.5s ease backwards;
}

.side__glow {
  position: absolute;
  top: -20%;
  right: -30%;
  width: 640px;
  height: 640px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(90, 174, 128, 0.35), transparent);
  pointer-events: none;
  animation:
    fade-in 1.4s 0.3s ease backwards,
    drift 14s ease-in-out infinite;
}

.logo {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 12px;
  text-decoration: none;
  animation: rise 0.8s 0.4s var(--ease-out) backwards;
}

.logo__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #5aae80;
  color: #1f3d2e;
  font-size: 22px;
  font-weight: 700;
  transition: transform 0.3s var(--ease-out);
}

.logo:hover .logo__icon {
  transform: rotate(-8deg) scale(1.06);
}

.logo__name {
  font-size: 24px;
  font-weight: 700;
  color: #fbf7ee;
}

.logo__name span {
  color: #8fd1ab;
}

.side__content {
  position: relative;
  z-index: 1;
}

.side__title {
  margin: 0 0 18px;
  font-size: clamp(38px, 3.6vw, 54px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.line {
  display: block;
  overflow: hidden;
  padding-bottom: 0.08em;
}

.line__inner {
  display: inline-block;
  animation: line-up 0.9s var(--d) var(--ease-out) backwards;
}

.side__accent {
  display: inline-block;
  color: #8fd1ab;
  animation: glow-text 3s 1.6s ease-in-out infinite;
}

.side__text {
  max-width: 380px;
  margin: 0;
  font-size: 17px;
  line-height: 1.6;
  color: rgba(251, 247, 238, 0.7);
  animation: rise 0.8s 0.85s var(--ease-out) backwards;
}

.side__route {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  height: auto;
  overflow: visible;
}

.route-draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: draw 1.4s 0.9s var(--ease-out) forwards;
}

.pop {
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: pop 0.6s var(--ease-out) backwards;
}

.pop--start {
  transform-origin: center;
  animation-delay: 0.85s;
}

.pop--pin {
  animation-delay: 1.9s;
}

.route-car {
  animation: fade-in 0.4s 1.6s ease backwards;
}

.main {
  display: grid;
  place-items: center;
  padding: 48px;
}

.panel {
  width: 100%;
  max-width: 460px;
}

.switch {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 36px;
  padding: 5px;
  border-radius: 16px;
  background: #f1ebdd;
  animation: drop 0.7s 0.35s var(--ease-out) backwards;
}

.switch__pill {
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 5px;
  width: calc(50% - 5px);
  border-radius: 12px;
  background: #fffdf8;
  box-shadow: 0 4px 14px rgba(60, 50, 30, 0.1);
  transition: transform 0.45s cubic-bezier(0.34, 1.4, 0.5, 1);
}

.switch--register .switch__pill {
  transform: translateX(100%);
}

.switch__btn {
  position: relative;
  z-index: 1;
  padding: 12px;
  border: none;
  background: transparent;
  color: #8a8578;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.25s ease,
    transform 0.15s ease;
}

.switch__btn:active {
  transform: scale(0.96);
}

.switch__btn--active {
  color: #2b2b26;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stagger {
  animation: rise 0.6s calc(var(--base) + var(--i) * 55ms) var(--ease-out) backwards;
}

.head {
  margin-bottom: 28px;
}

.head__title {
  margin: 0 0 8px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2b2b26;
}

.head__text {
  margin: 0;
  font-size: 16px;
  color: #8a8578;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.field__label {
  font-size: 14px;
  font-weight: 600;
  color: #4a473f;
  transition: color 0.2s ease;
}

.field:focus-within .field__label {
  color: #2f7d57;
}

.field__label em {
  margin-left: 4px;
  font-style: normal;
  font-weight: 400;
  color: #a39e90;
}

.field__control {
  position: relative;
  display: block;
}

.field__input {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: 1.5px solid #e6dfcf;
  border-radius: 14px;
  background: #fffdf8;
  color: #2b2b26;
  font-family: inherit;
  font-size: 15px;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease,
    background-color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.field__input::placeholder {
  color: #b5ae9f;
  transition: opacity 0.2s ease;
}

.field__input:hover {
  border-color: #d6cdb8;
}

.field__input:focus {
  border-color: #2f7d57;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(47, 125, 87, 0.12);
  transform: translateY(-1px);
}

.field__input:focus::placeholder {
  opacity: 0.5;
}

.field__control .field__input {
  padding-right: 52px;
}

.field__input--date {
  cursor: pointer;
}

.field__input--empty {
  color: #b5ae9f;
}

.field__input--date::-webkit-calendar-picker-indicator {
  opacity: 0.5;
  cursor: pointer;
}

.field__eye {
  position: absolute;
  top: 50%;
  right: 8px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #8a8578;
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.field__eye:hover {
  background: #f1ebdd;
  color: #2f7d57;
}

.field__eye svg {
  width: 20px;
  height: 20px;
}

.field__eye-slash {
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 0.3s var(--ease-out);
}

.field__eye--on .field__eye-slash {
  stroke-dashoffset: 1;
}

.field--error .field__input {
  border-color: #c2543f;
}

.field--error .field__input:focus {
  box-shadow: 0 0 0 4px rgba(194, 84, 63, 0.12);
}

.form--shake .field--error .field__input,
.form--shake .alert--error {
  animation: shake 0.42s ease;
}

.field__error {
  font-size: 13px;
  color: #c2543f;
}

.alert {
  margin: 0;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
}

.alert--error {
  background: #fbeae6;
  color: #9f3a28;
}

.alert--success {
  background: #e3efe7;
  color: #2f7d57;
}

.submit {
  position: relative;
  display: grid;
  place-items: center;
  height: 56px;
  margin-top: 4px;
  border: none;
  border-radius: 14px;
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
    background-color 0.3s ease,
    box-shadow 0.2s ease;
  animation: rise 0.6s calc(var(--base) + 0.45s) var(--ease-out) backwards;
}

.submit:hover:not(:disabled) {
  background: #266a49;
  transform: translateY(-2px);
  box-shadow: 0 14px 34px rgba(47, 125, 87, 0.35);
}

.submit:active:not(:disabled) {
  transform: scale(0.98);
}

.submit:hover:not(:disabled) .submit__arrow {
  transform: translateX(4px);
}

.submit:hover:not(:disabled) .submit__shine {
  transform: translateX(120%) skewX(-20deg);
}

.submit:disabled {
  cursor: progress;
}

.submit--locked,
.submit:disabled:not(.submit--loading):not(.submit--success) {
  background: #8a9e92;
  box-shadow: none;
  cursor: not-allowed;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.checks__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f1ebdd;
  color: #8a8578;
  font-size: 12.5px;
  font-weight: 500;
  transition:
    background-color 0.25s ease,
    color 0.25s ease;
}

.checks__item::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
  transition:
    transform 0.25s var(--ease-out),
    opacity 0.25s ease;
}

.checks__item--ok {
  background: #e3efe7;
  color: #2f7d57;
}

.checks__item--ok::before {
  opacity: 1;
  transform: scale(1.3);
}

.submit--success {
  background: #3f9a6c;
  animation: success-pulse 0.65s var(--ease-out);
}

.submit__shine {
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  transform: translateX(-160%) skewX(-20deg);
  transition: transform 0.7s var(--ease-out);
  pointer-events: none;
}

.submit__content {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.submit__arrow {
  width: 20px;
  height: 20px;
  transition: transform 0.2s ease;
}

.submit__spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(251, 247, 238, 0.35);
  border-top-color: #fbf7ee;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.submit__check {
  width: 26px;
  height: 26px;
}

.submit__check path {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: draw 0.45s 0.1s var(--ease-out) forwards;
}

.foot {
  margin: 28px 0 0;
  font-size: 15px;
  text-align: center;
  color: #8a8578;
  animation: fade-in 0.6s calc(var(--base) + 0.6s) ease backwards;
}

.foot__link {
  position: relative;
  padding: 0;
  border: none;
  background: none;
  color: #2f7d57;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  cursor: pointer;
}

.foot__link::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: right;
  transition: transform 0.3s var(--ease-out);
}

.foot__link:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}

.swap-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.err-enter-active,
.err-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s var(--ease-out);
}

.err-enter-from,
.err-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.alert-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.4s var(--ease-out);
}

.alert-leave-active {
  transition: opacity 0.15s ease;
}

.alert-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.alert-leave-to {
  opacity: 0;
}

.label-enter-active,
.label-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.label-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.label-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes side-in {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes line-up {
  from {
    transform: translateY(110%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes pop {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  70% {
    opacity: 1;
    transform: scale(1.15);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes drift {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: -60px 40px;
  }
}

@keyframes glow-text {
  0%,
  100% {
    text-shadow: 0 0 0 rgba(143, 209, 171, 0);
  }
  50% {
    text-shadow: 0 0 24px rgba(143, 209, 171, 0.55);
  }
}

@keyframes shake {
  0%,
  100% {
    translate: 0 0;
  }
  20% {
    translate: -6px 0;
  }
  40% {
    translate: 5px 0;
  }
  60% {
    translate: -3px 0;
  }
  80% {
    translate: 2px 0;
  }
}

@keyframes success-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(63, 154, 108, 0.5);
  }
  100% {
    box-shadow: 0 0 0 16px rgba(63, 154, 108, 0);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes side-down {
  from {
    clip-path: inset(0 0 100% 0 round 0 0 32px 32px);
  }
  to {
    clip-path: inset(0 0 0 0 round 0 0 32px 32px);
  }
}

@keyframes sheet-up {
  from {
    opacity: 0;
    transform: translateY(40px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1100px) {
  .side {
    padding: 36px 40px 40px;
  }

  .main {
    padding: 40px 32px;
  }
}

@media (max-width: 860px) {
  .auth {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    overflow: visible;
  }

  .side {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'logo logo'
      'content route';
    align-items: end;
    gap: 28px 16px;
    padding: calc(20px + env(safe-area-inset-top)) 24px 56px;
    border-radius: 0 0 32px 32px;
    animation: side-down 0.9s var(--ease-out) backwards;
  }

  .side__glow {
    top: -40%;
    right: -50%;
    width: 420px;
    height: 420px;
  }

  .logo {
    grid-area: logo;
  }

  .logo__icon {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    font-size: 20px;
  }

  .logo__name {
    font-size: 21px;
  }

  .side__content {
    grid-area: content;
  }

  .side__title {
    margin-bottom: 10px;
    font-size: clamp(28px, 6.4vw, 40px);
  }

  .side__text {
    font-size: 15px;
  }

  .side__route {
    grid-area: route;
    width: clamp(150px, 34vw, 260px);
    margin-bottom: 6px;
  }

  .main {
    position: relative;
    z-index: 1;
    align-items: start;
    margin-top: -28px;
    padding: 28px 24px calc(32px + env(safe-area-inset-bottom));
    border-radius: 28px 28px 0 0;
    background: #fbf7ee;
    animation: sheet-up 0.7s 0.25s var(--ease-out) backwards;
  }

  .panel {
    max-width: 520px;
    margin: 0 auto;
  }

  .switch {
    margin-bottom: 28px;
  }

  .head {
    margin-bottom: 22px;
  }

  .head__title {
    font-size: 28px;
  }

  .head__text {
    font-size: 15px;
  }

  .field__input {
    height: 54px;
    font-size: 16px;
  }

  .submit {
    height: 58px;
    font-size: 17px;
  }

  .foot {
    margin-top: 22px;
  }
}

@media (max-width: 520px) {
  .side {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'logo'
      'content';
    gap: 22px;
    padding: calc(16px + env(safe-area-inset-top)) 20px 50px;
  }

  .side__route {
    position: absolute;
    right: -24px;
    bottom: 18px;
    width: 170px;
    margin: 0;
    opacity: 0.55;
    pointer-events: none;
  }

  .side__text {
    display: none;
  }

  .side__title {
    margin: 0;
    font-size: clamp(27px, 8.2vw, 34px);
  }

  .main {
    padding: 24px 18px calc(28px + env(safe-area-inset-bottom));
    border-radius: 26px 26px 0 0;
  }

  .switch {
    margin-bottom: 24px;
    border-radius: 14px;
  }

  .switch__pill {
    border-radius: 10px;
  }

  .switch__btn {
    padding: 13px 10px;
  }

  .head__title {
    font-size: 26px;
  }

  .fields {
    gap: 14px;
  }

  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }

  .row--names {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .field__label em {
    display: block;
    margin: 2px 0 0;
    font-size: 12px;
  }

  .field__label {
    font-size: 13.5px;
  }

  .field__input {
    padding: 0 14px;
    border-radius: 13px;
  }

  .field__control .field__input {
    padding-right: 50px;
  }

  .alert {
    font-size: 13.5px;
  }
}

@media (max-width: 350px) {
  .row--names {
    grid-template-columns: minmax(0, 1fr);
  }

  .side__route {
    display: none;
  }
}

@media (hover: none) {
  .submit:hover:not(:disabled) {
    background: #2f7d57;
    transform: none;
    box-shadow: 0 10px 28px rgba(47, 125, 87, 0.28);
  }

  .submit:hover:not(:disabled) .submit__shine {
    transform: translateX(-160%) skewX(-20deg);
  }

  .submit:active:not(:disabled) .submit__shine {
    transform: translateX(120%) skewX(-20deg);
  }

  .submit:hover:not(:disabled) .submit__arrow {
    transform: none;
  }

  .submit:active:not(:disabled) {
    transform: scale(0.98);
  }

  .field__input:focus {
    transform: none;
  }

  .field__eye:hover {
    background: transparent;
    color: #8a8578;
  }

  .field__eye:active {
    background: #f1ebdd;
  }

  .switch__btn,
  .foot__link,
  .field__eye,
  .submit {
    -webkit-tap-highlight-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>