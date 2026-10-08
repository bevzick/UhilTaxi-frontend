import { computed, ref } from 'vue'
import { authApi } from '@/api/auth'
import type { AuthResponse, LoginRequest, RegisterRequest, UserResponse } from '@/types/auth'

const STORAGE_KEY = 'uhiltaxi.session'

interface Session {
  token: string
  expiresAt: number | null
  user: UserResponse | null
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

const session = ref<Session | null>(loadSession())

function saveSession(response: AuthResponse | null): boolean {
  if (!response?.access_token) return false

  const next: Session = {
    token: response.access_token,
    expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : null,
    user: response.user ?? null,
  }

  session.value = next

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    return true
  }

  return true
}

export function useAuth() {
  const token = computed(() => session.value?.token ?? null)
  const user = computed(() => session.value?.user ?? null)
  const isAuthenticated = computed(
    () => !!session.value && (!session.value.expiresAt || session.value.expiresAt > Date.now()),
  )

  async function login(data: LoginRequest) {
    return saveSession(await authApi.login(data))
  }

  async function register(data: RegisterRequest) {
    return saveSession(await authApi.register(data))
  }

  function logout() {
    session.value = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      return
    }
  }

  return { token, user, isAuthenticated, login, register, logout }
}