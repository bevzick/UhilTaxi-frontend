import { ApiError, request } from './http'
import { MOCK_API, mockApi } from './mock.ts'
import { inCity } from '@/config/city'
import { useAuth } from '@/composables/useAuth'
import { distanceMeters } from '@/utils/geo'
import { toEstimate, toOrder, toPaged, toTariffs, toTrip } from '@/utils/order'
import { clean } from '@/utils/validation'
import type { CreateOrderRequest, Estimate, OrderView, Paged, Tariff, TripView } from '@/types/order'
import type { Place } from '@/types/geo'

const V1 = '/api/v1'
const ADDRESS_MAX = 200
const MIN_TRIP_METERS = 50
export const PROMO_MAX = 32
const PROMO_RE = /^[A-Z0-9_-]{2,32}$/

type Method = 'GET' | 'POST' | 'PATCH'

export async function authed(path: string, method: Method = 'GET', body?: unknown): Promise<unknown> {
  const { token, logout } = useAuth()
  try {
    return await request<unknown>(path, { method, body, token: token.value })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      logout()
      const { default: router } = await import('@/router')
      await router.replace({ name: 'auth', query: { redirect: router.currentRoute.value.fullPath } })
    }
    throw error
  }
}

export function must<T>(value: T | null): T {
  if (value === null) throw new ApiError('Некоректна відповідь сервера', 0)
  return value
}

export const pageQuery = (page: number, limit: number) => `page=${Math.max(1, page)}&limit=${Math.min(50, Math.max(1, limit))}`

export interface OrderDraft {
  pickup: Place | null
  destination: Place | null
  tariffId: number | null
  promocode: string
}

const cleanText = (value: string, max: number) => clean(value).replace(/\s+/g, ' ').trim().slice(0, max)
const round = (value: number) => Math.round(value * 1e6) / 1e6

function validPlace(place: Place | null): place is Place {
  return !!place && !place.pending && inCity(place.lat, place.lng) && cleanText(place.address, ADDRESS_MAX).length > 0
}

export const normalizePromo = (value: string) => clean(value, 'NFKC').replace(/\s+/g, '').toUpperCase().slice(0, PROMO_MAX)

export function validatePromo(value: string) {
  const code = normalizePromo(value)
  return !code || PROMO_RE.test(code) ? null : 'Лише латинські літери, цифри, «-» та «_»'
}

export function prepareOrder(draft: OrderDraft): { data: CreateOrderRequest } | { error: string } {
  if (!validPlace(draft.pickup)) return { error: 'Вкажіть, звідки вас забрати' }
  if (!validPlace(draft.destination)) return { error: 'Вкажіть, куди їдемо' }
  if (distanceMeters(draft.pickup, draft.destination) < MIN_TRIP_METERS) return { error: 'Точки маршруту надто близько' }
  if (draft.tariffId === null || !Number.isSafeInteger(draft.tariffId)) return { error: 'Оберіть тариф' }
  const promoError = validatePromo(draft.promocode)
  if (promoError) return { error: promoError }

  const point = (place: Place) => ({
    address: cleanText(place.address, ADDRESS_MAX),
    lat: round(place.lat),
    lng: round(place.lng),
  })

  return {
    data: {
      tariff_id: draft.tariffId,
      pickup: point(draft.pickup),
      destination: point(draft.destination),
      promocode: normalizePromo(draft.promocode) || null,
    },
  }
}

export const ordersApi = {
  async tariffs(): Promise<Tariff[]> {
    return toTariffs(MOCK_API ? await mockApi.tariffs() : await authed(`${V1}/tariffs`))
  },

  async estimate(data: CreateOrderRequest): Promise<Estimate> {
    return must(toEstimate(MOCK_API ? await mockApi.estimate(data) : await authed(`${V1}/orders/estimate`, 'POST', data)))
  },

  async create(data: CreateOrderRequest): Promise<OrderView> {
    return must(toOrder(MOCK_API ? await mockApi.createOrder(data) : await authed(`${V1}/orders`, 'POST', data)))
  },

  async get(id: number): Promise<OrderView> {
    return must(toOrder(MOCK_API ? await mockApi.getOrder(id) : await authed(`${V1}/orders/${id}`)))
  },

  async cancel(id: number, reason: string | null): Promise<OrderView> {
    const body = { reason }
    return must(toOrder(MOCK_API ? await mockApi.cancelOrder(id, body) : await authed(`${V1}/orders/${id}/cancel`, 'POST', body)))
  },
}

export const driverApi = {
  async available(page = 1, limit = 20): Promise<Paged<OrderView>> {
    const raw = MOCK_API
      ? await mockApi.driverAvailable()
      : await authed(`${V1}/driver/orders/available?${pageQuery(page, limit)}`)
    return toPaged(raw, toOrder)
  },

  async assigned(page = 1, limit = 20): Promise<Paged<OrderView>> {
    const raw = MOCK_API ? await mockApi.driverAssigned() : await authed(`${V1}/driver/orders/assigned?${pageQuery(page, limit)}`)
    return toPaged(raw, toOrder)
  },

  async get(id: number): Promise<OrderView> {
    return must(toOrder(MOCK_API ? await mockApi.driverGet(id) : await authed(`${V1}/driver/orders/${id}`)))
  },

  async accept(id: number): Promise<OrderView> {
    return must(toOrder(MOCK_API ? await mockApi.driverAccept(id) : await authed(`${V1}/driver/orders/${id}/accept`, 'POST')))
  },

  async arrived(id: number): Promise<OrderView> {
    return must(toOrder(MOCK_API ? await mockApi.driverArrived(id) : await authed(`${V1}/driver/orders/${id}/arrived`, 'POST')))
  },

  async start(id: number): Promise<TripView | null> {
    // The API requires a shift_id but exposes no shift endpoint yet; 0 lets the backend pick the active shift.
    const body = { shift_id: 0 }
    return toTrip(MOCK_API ? await mockApi.driverStart(id) : await authed(`${V1}/driver/orders/${id}/start`, 'POST', body))
  },

  async complete(id: number, distanceKm: number | null): Promise<TripView | null> {
    const body = { distance_km: distanceKm }
    return toTrip(MOCK_API ? await mockApi.driverComplete(id, body) : await authed(`${V1}/driver/orders/${id}/complete`, 'POST', body))
  },

  async trips(page = 1, limit = 10): Promise<Paged<TripView>> {
    const raw = MOCK_API ? await mockApi.driverTrips() : await authed(`${V1}/driver/trips?${pageQuery(page, limit)}`)
    return toPaged(raw, toTrip)
  },
}
