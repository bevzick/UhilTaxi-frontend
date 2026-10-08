import { ApiError } from './http'
import type { AuthResponse, LoginRequest, RegisterRequest, UserResponse } from '@/types/auth'
import type { OrderRequest, OrderResponse } from '@/types/order'

export const MOCK_API = import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true'

if (MOCK_API) console.warn('[UhilTaxi] Демо-режим: запити до API підмінено фейковими відповідями')

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let profile: UserResponse = {
  id: 1,
  first_name: 'Тестовий',
  last_name: 'Користувач',
  phone: '+380971234567',
  email: 'test@uhiltaxi.ua',
  role: 'client',
  status: 'active',
  birth_date: null,
}

const session = (): AuthResponse => ({
  access_token: `mock-token-${Date.now()}`,
  expires_in: 60 * 60 * 8,
  user: { ...profile },
})

export const mockApi = {
  async login(data: LoginRequest): Promise<AuthResponse> {
    await delay(700)
    if (data.password === 'wrong') throw new ApiError('Невірний телефон або пароль', 401)
    if (data.phone === '+380000000000') throw new ApiError('Сервер тимчасово недоступний. Спробуйте пізніше', 500)
    profile = { ...profile, phone: data.phone }
    return session()
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    await delay(900)
    if (data.phone === '+380000000000') throw new ApiError('Користувач з таким номером вже існує', 409)
    profile = {
      ...profile,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      email: data.email,
      birth_date: data.birth_date,
    }
    return session()
  },

  async createOrder(data: OrderRequest): Promise<OrderResponse> {
    await delay(1200)
    if (data.comment === 'error') throw new ApiError('Не вдалося створити замовлення', 400)
    console.info('[UhilTaxi] Демо-замовлення:', data)
    return { id: Math.floor(1000 + Math.random() * 9000), status: 'searching' }
  },
}