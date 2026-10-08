import { computed, ref } from 'vue'
import { authApi } from '@/api/auth'
import { ApiError } from '@/api/http'
import type { AuthResponse, LoginRequest, RegisterRequest, UserResponse } from '@/types/auth'

const STORAGE_KEY = 'uhiltaxi.session'
const MAX_TOKEN_LENGTH = 8192
const MAX_EXPIRES_IN = 60 * 60 * 24 * 365
const TOKEN_RE = /^[\x21-\x7E]+$/

interface Session {
  token: string
  expiresAt: number | null
  user: UserResponse | null
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isValidToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && TOKEN_RE.test(value)

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)

function toId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value)
  return null
}

function toUser(value: unknown): UserResponse | null {
  if (!isObject(value)) return null
  const id = toId(value.id)
  if (id === null) return null

  const birth = text(value.birth_date, 40)

  return {
    id,
    first_name: text(value.first_name, 100),
    last_name: text(value.last_name, 100),
    phone: text(value.phone, 20),
    email: text(value.email, 254),
    role: text(value.role, 50),
    status: text(value.status, 50),
    birth_date: birth && DATE_RE.test(birth) ? birth.slice(0, 10) : null,
  }
}

function toStoredSession(value: unknown): Session | null {
  if (!isObject(value) || !isValidToken(value.token)) return null

  const raw = value.expiresAt
  let expiresAt: number | null

  if (raw === null) expiresAt = null
  else if (typeof raw === 'number' && Number.isFinite(raw) && raw > Date.now()) expiresAt = raw
  else return null

  return { token: value.token, expiresAt, user: toUser(value.user) }
}

function readStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = toStoredSession(JSON.parse(raw) as unknown)
    if (!stored) localStorage.removeItem(STORAGE_KEY)
    return stored
  } catch {
    return null
  }
}

function writeStorage(value: Session | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}

export type Role = 'client' | 'driver' | 'admin'

export function normalizeRole(value: string | null | undefined): Role {
  const role = (value ?? '').toLowerCase()
  if (role.includes('driver')) return 'driver'
  if (role.includes('admin')) return 'admin'
  return 'client'
}

const session = ref<Session | null>(readStorage())

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) session.value = readStorage()
  })
}

function toSession(response: unknown): Session | null {
  if (!isObject(response) || !isValidToken(response.access_token)) return null

  const expiresIn = response.expires_in
  const validExpires = typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn <= MAX_EXPIRES_IN

  return {
    token: response.access_token,
    expiresAt: validExpires ? Date.now() + expiresIn * 1000 : null,
    user: toUser(response.user),
  }
}

function applySession(response: AuthResponse | null): boolean {
  const next = toSession(response)
  if (!next) return false
  session.value = next
  writeStorage(next)
  return true
}

export function useAuth() {
  const token = computed(() => session.value?.token ?? null)
  const user = computed(() => session.value?.user ?? null)
  const role = computed(() => normalizeRole(user.value?.role))
  const isDriver = computed(() => role.value === 'driver')
  const isAuthenticated = computed(
    () => !!session.value && (session.value.expiresAt === null || session.value.expiresAt > Date.now()),
  )

  async function login(data: LoginRequest) {
    if (!applySession(await authApi.login(data))) throw new ApiError('Некоректна відповідь сервера', 0)
    return true
  }

  async function register(data: RegisterRequest) {
    return applySession(await authApi.register(data))
  }

  function logout() {
    session.value = null
    writeStorage(null)
  }

  return { token, user, role, isDriver, isAuthenticated, login, register, logout }
}