import { safeMessage } from '../utils/validation'

const TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1_000_000

function resolveBaseUrl(raw: string | undefined) {
  try {
    const url = new URL(raw ?? '')
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol')
    if (import.meta.env.PROD && url.protocol !== 'https:') throw new Error('insecure')
    // Every request path already starts with /api/v1, so accept a base URL written either way.
    return url.origin + url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '')
  } catch {
    console.error('VITE_API_URL має бути коректною адресою http(s)')
    return ''
  }
}

const BASE_URL = resolveBaseUrl(import.meta.env.VITE_API_URL)

export class ApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

const GENERIC = 'Щось пішло не так. Спробуйте ще раз'

function serverMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return safeMessage(data)
  const record = data as Record<string, unknown>

  if (record.errors && typeof record.errors === 'object') {
    for (const value of Object.values(record.errors as Record<string, unknown>)) {
      const first = Array.isArray(value) ? value[0] : value
      const message = safeMessage(first)
      if (message) return message
    }
  }

  for (const key of ['message', 'detail', 'title', 'error']) {
    const message = safeMessage(record[key])
    if (message) return message
  }

  return null
}

function errorMessage(data: unknown, status: number) {
  if (status === 401) return 'Невірний телефон або пароль'
  if (status === 403) return 'Доступ заборонено'
  if (status === 429) return 'Забагато спроб. Спробуйте трохи пізніше'
  if (status >= 500) return 'Сервер тимчасово недоступний. Спробуйте пізніше'
  if (status === 409) return serverMessage(data) ?? 'Користувач з такими даними вже існує'
  return serverMessage(data) ?? GENERIC
}

function isSafePath(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('..') && !/[\s\\]/.test(path)
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options

  if (!BASE_URL || !isSafePath(path)) throw new ApiError('Невірна конфігурація API', 0)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    let response: Response

    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) throw new ApiError('Сервер не відповідає. Спробуйте ще раз', 0)
      throw new ApiError("Немає з'єднання з сервером", 0)
    }

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_RESPONSE_BYTES) throw new ApiError(GENERIC, response.status)

    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) throw new ApiError(GENERIC, response.status)

    let data: unknown = null
    if (text) {
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('json')) {
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
      } else {
        data = text
      }
    }

    if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status, data)

    return data as T
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}