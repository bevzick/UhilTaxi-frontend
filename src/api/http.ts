const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

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

function extractMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) return data

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>

    if (record.errors && typeof record.errors === 'object') {
      const first = (Object.values(record.errors as Record<string, unknown>) as unknown[]).flat()[0]
      if (typeof first === 'string') return first
    }

    for (const key of ['message', 'detail', 'title', 'error']) {
      const value = record[key]
      if (typeof value === 'string' && value) return value
    }
  }

  if (status === 401) return 'Невірний телефон або пароль'
  if (status === 409) return 'Користувач з такими даними вже існує'
  if (status >= 500) return 'Сервер тимчасово недоступний. Спробуйте пізніше'
  return 'Щось пішло не так. Спробуйте ще раз'
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError("Немає з'єднання з сервером", 0)
  }

  const text = await response.text()
  let data: unknown = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) throw new ApiError(extractMessage(data, response.status), response.status, data)

  return data as T
}