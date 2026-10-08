export const LIMITS = {
  nameMin: 2,
  nameMax: 50,
  phoneMax: 20,
  emailMax: 254,
  emailLocalMax: 64,
  passwordMin: 8,
  passwordMax: 128,
  minAge: 14,
  maxAge: 120,
  messageMax: 200,
  redirectMax: 512,
} as const

const INVISIBLE_CHARS = '\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF'
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CHARS}]`, 'g')
const INVISIBLE_ANY = new RegExp(`[${INVISIBLE_CHARS}]`)
const APOSTROPHES = /[‘’ʼ`´]/g
const NAME_RE = /^(?:\p{L}\p{M}*)+(?:[ '-](?:\p{L}\p{M}*)+)*$/u
const UA_PHONE_RE = /^\+380\d{9}$/
const E164_RE = /^\+[1-9]\d{9,14}$/
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export type ValidationResult = string | null

const REQUIRED = 'Заповніть це поле'
const length = (value: string) => [...value].length

export function clean(value: string, form: 'NFC' | 'NFKC' = 'NFC') {
  return value.normalize(form).replace(INVISIBLE_ALL, '')
}

export function hasInvisible(value: string) {
  return INVISIBLE_ANY.test(value)
}

export function normalizeName(value: string) {
  return clean(value).replace(APOSTROPHES, "'").replace(/\s+/g, ' ').trim()
}

export function validateName(value: string): ValidationResult {
  const name = normalizeName(value)
  if (!name) return REQUIRED
  if (length(name) < LIMITS.nameMin) return 'Занадто коротко'
  if (length(name) > LIMITS.nameMax) return `Максимум ${LIMITS.nameMax} символів`
  if (!NAME_RE.test(name)) return 'Лише літери, апостроф, дефіс або пробіл'
  return null
}

export function filterPhoneInput(value: string) {
  return clean(value, 'NFKC')
    .replace(/[^\d+\s()-]/g, '')
    .replace(/(?!^)\+/g, '')
    .slice(0, LIMITS.phoneMax)
}

export function normalizePhone(value: string) {
  let phone = clean(value, 'NFKC').replace(/[\s()-]/g, '')
  if (/^0\d{9}$/.test(phone)) phone = `+38${phone}`
  else if (/^380\d{9}$/.test(phone)) phone = `+${phone}`
  return phone
}

export function validatePhone(value: string): ValidationResult {
  const phone = normalizePhone(value)
  if (!phone) return REQUIRED
  const valid = phone.startsWith('+380') ? UA_PHONE_RE.test(phone) : E164_RE.test(phone)
  return valid ? null : 'Некоректний номер телефону'
}

export function normalizeEmail(value: string) {
  const email = clean(value, 'NFKC').trim()
  const at = email.lastIndexOf('@')
  return at > 0 ? `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}` : email
}

export function validateEmail(value: string, required = false): ValidationResult {
  const email = normalizeEmail(value)
  if (!email) return required ? REQUIRED : null
  if (email.length > LIMITS.emailMax) return 'Занадто довгий email'
  if (email.slice(0, email.lastIndexOf('@')).length > LIMITS.emailLocalMax) return 'Занадто довгий email'
  return EMAIL_RE.test(email) ? null : 'Некоректний email'
}

export function passwordChecks(value: string) {
  return {
    length: value.length >= LIMITS.passwordMin && value.length <= LIMITS.passwordMax,
    letter: /\p{L}/u.test(value),
    digit: /\d/.test(value),
  }
}

export function validatePassword(value: string, strict: boolean): ValidationResult {
  if (!value) return REQUIRED
  if (hasInvisible(value)) return 'Пароль містить недопустимі символи'
  if (value.length > LIMITS.passwordMax) return `Максимум ${LIMITS.passwordMax} символів`
  if (!strict) return null
  if (value !== value.trim()) return 'Без пробілів на початку чи в кінці'
  const checks = passwordChecks(value)
  if (!checks.length) return `Мінімум ${LIMITS.passwordMin} символів`
  if (!checks.letter || !checks.digit) return 'Додайте хоча б одну літеру і цифру'
  return null
}

export function validateBirthDate(value: string): ValidationResult {
  if (!value) return null
  const match = DATE_RE.exec(value)
  if (!match) return 'Некоректна дата'

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return 'Некоректна дата'
  }

  const now = new Date()
  if (date.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) {
    return 'Дата не може бути в майбутньому'
  }

  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--

  if (age < LIMITS.minAge) return `Вам має бути щонайменше ${LIMITS.minAge} років`
  if (age > LIMITS.maxAge) return 'Перевірте дату народження'
  return null
}

export function safeMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const message = clean(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!message || message.length > LIMITS.messageMax) return null
  return message
}

export function safeRedirect(raw: unknown, fallback = '/') {
  if (typeof raw !== 'string' || !raw || raw.length > LIMITS.redirectMax) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001F\u007F]/.test(raw)) return fallback

  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return fallback
    if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}