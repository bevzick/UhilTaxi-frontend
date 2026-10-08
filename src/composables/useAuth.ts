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

function isValidSession(value: unknown): value is Session {
  if (!isObject(value) || !isValidToken(value.token)) return false
  if (value.expiresAt !== null && (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt))) return false
  return value.user === null || isObject(value.user)
}

function readStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidSession(parsed) || (parsed.expiresAt !== null && parsed.expiresAt <= Date.now())) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
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
    user: isObject(response.user) ? (response.user as UserResponse) : null,
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

  return { token, user, isAuthenticated, login, register, logout }
}