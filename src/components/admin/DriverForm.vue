<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { LIMITS, normalizeEmail, normalizeName, normalizePhone, validateEmail, validateName, validatePassword, validatePhone } from '@/utils/validation'
import type { AdminDriver, CreateDriverRequest, UpdateDriverRequest } from '@/types/admin'

export interface DriverFormSeed {
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
}

const props = defineProps<{ driver?: AdminDriver | null; seed?: DriverFormSeed | null; busy?: boolean; error?: string }>()
const emit = defineEmits<{ create: [data: CreateDriverRequest]; update: [data: UpdateDriverRequest] }>()

const LICENSE_RE = /^[A-ZА-ЯІЇЄҐ0-9 -]{5,20}$/u
const today = () => new Date().toISOString().slice(0, 10)

const editing = computed(() => !!props.driver)
const f = reactive({ firstName: '', lastName: '', phone: '', email: '', password: '', license: '', hireDate: today() })
const touched = ref(false)

watch(
  () => [props.driver, props.seed],
  () => {
    const d = props.driver
    const s = props.seed
    f.firstName = d?.firstName ?? s?.firstName ?? ''
    f.lastName = d?.lastName ?? s?.lastName ?? ''
    f.phone = d?.phone ?? s?.phone ?? ''
    f.email = d?.email ?? s?.email ?? ''
    f.password = ''
    f.license = d?.licenseNumber ?? ''
    f.hireDate = d?.hireDate ?? today()
    touched.value = false
  },
  { immediate: true },
)

const errors = computed(() => {
  const license = f.license.trim().toUpperCase()
  return {
    firstName: validateName(f.firstName),
    lastName: validateName(f.lastName),
    phone: editing.value ? null : validatePhone(f.phone),
    email: validateEmail(f.email),
    password: editing.value ? null : validatePassword(f.password, true),
    license: !license ? 'Вкажіть номер посвідчення' : LICENSE_RE.test(license) ? null : 'Літери, цифри, пробіл або дефіс (5–20)',
    hireDate: editing.value ? null : !f.hireDate ? 'Вкажіть дату' : f.hireDate > today() ? 'Дата не може бути в майбутньому' : null,
  }
})

const show = (key: keyof typeof errors.value) => (touched.value ? errors.value[key] : null)

function submit() {
  touched.value = true
  if (Object.values(errors.value).some(Boolean)) return
  const base = {
    first_name: normalizeName(f.firstName),
    last_name: normalizeName(f.lastName),
    email: normalizeEmail(f.email) || null,
    license_number: f.license.trim().toUpperCase().replace(/\s+/g, ' '),
  }
  if (editing.value) emit('update', base)
  else emit('create', { ...base, phone: normalizePhone(f.phone), password: f.password, hire_date: f.hireDate })
}

defineExpose({ submit })
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <div class="a-grid">
      <label class="a-field">
        <span class="a-label">Ім'я</span>
        <input v-model="f.firstName" class="a-input" :class="{ 'a-input--invalid': show('firstName') }" :maxlength="LIMITS.nameMax" autocomplete="off" />
        <span v-if="show('firstName')" class="a-error">{{ show('firstName') }}</span>
      </label>
      <label class="a-field">
        <span class="a-label">Прізвище</span>
        <input v-model="f.lastName" class="a-input" :class="{ 'a-input--invalid': show('lastName') }" :maxlength="LIMITS.nameMax" autocomplete="off" />
        <span v-if="show('lastName')" class="a-error">{{ show('lastName') }}</span>
      </label>

      <label class="a-field">
        <span class="a-label">Телефон</span>
        <input
          v-model="f.phone"
          class="a-input"
          :class="{ 'a-input--invalid': show('phone') }"
          type="tel"
          :disabled="editing"
          :maxlength="LIMITS.phoneMax"
          placeholder="+380"
          autocomplete="off"
        />
        <span v-if="show('phone')" class="a-error">{{ show('phone') }}</span>
        <span v-else-if="editing" class="a-muted hint">Телефон водія змінити через API не можна</span>
      </label>
      <label class="a-field">
        <span class="a-label">Email</span>
        <input v-model="f.email" class="a-input" :class="{ 'a-input--invalid': show('email') }" type="email" :maxlength="LIMITS.emailMax" placeholder="Необов'язково" autocomplete="off" />
        <span v-if="show('email')" class="a-error">{{ show('email') }}</span>
      </label>

      <label class="a-field">
        <span class="a-label">Посвідчення водія</span>
        <input v-model="f.license" class="a-input license" :class="{ 'a-input--invalid': show('license') }" maxlength="20" placeholder="ВХК 123456" autocomplete="off" />
        <span v-if="show('license')" class="a-error">{{ show('license') }}</span>
      </label>
      <label v-if="!editing" class="a-field">
        <span class="a-label">Дата прийому</span>
        <input v-model="f.hireDate" class="a-input" :class="{ 'a-input--invalid': show('hireDate') }" type="date" :max="today()" />
        <span v-if="show('hireDate')" class="a-error">{{ show('hireDate') }}</span>
      </label>

      <label v-if="!editing" class="a-field a-span">
        <span class="a-label">Тимчасовий пароль</span>
        <input v-model="f.password" class="a-input" :class="{ 'a-input--invalid': show('password') }" type="text" :maxlength="LIMITS.passwordMax" placeholder="Мінімум 8 символів, літера і цифра" autocomplete="new-password" />
        <span v-if="show('password')" class="a-error">{{ show('password') }}</span>
        <span v-else class="a-muted hint">Передайте пароль водію — він зможе змінити його в профілі</span>
      </label>
    </div>

    <p v-if="error" class="a-alert">{{ error }}</p>
    <button type="submit" hidden :disabled="busy"></button>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hint {
  font-size: 12.5px;
}

.license {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
