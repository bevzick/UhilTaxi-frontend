import { authed, must, pageQuery } from './orders'
import { MOCK_API, mockAdmin } from './mock.ts'
import {
  toAdminTariff,
  toAdminTariffs,
  toClient,
  toClients,
  toDriver,
  toDrivers,
  toHistoryList,
  toPromocode,
  toPromocodes,
} from '@/utils/admin'
import { toEstimate, toOrder, toPaged, toTrip } from '@/utils/order'
import type {
  AdminClient,
  AdminDriver,
  AdminTariff,
  CreateDriverRequest,
  HistoryEntry,
  Promocode,
  PromocodeRequest,
  TariffRequest,
  UpdateDriverRequest,
} from '@/types/admin'
import type { CreateOrderRequest, Estimate, OrderView, Paged, TripView } from '@/types/order'

const A = '/api/v1/admin'

type Method = 'GET' | 'POST' | 'PATCH'

/** Routes every admin call either to the real API or to the in-browser mock backend. */
const call = (method: Method, path: string, body?: unknown) =>
  MOCK_API ? mockAdmin.handle(method, path, body) : authed(`${A}${path}`, method, body)

export const adminApi = {
  // Clients
  clients: async (): Promise<AdminClient[]> => toClients(await call('GET', '/clients')),
  client: async (id: number): Promise<AdminClient> => must(toClient(await call('GET', `/clients/${id}`))),
  setClientBlocked: async (id: number, blocked: boolean): Promise<AdminClient> =>
    must(toClient(await call('PATCH', `/clients/${id}/status`, { is_blocked: blocked }))),

  // Drivers
  drivers: async (): Promise<AdminDriver[]> => toDrivers(await call('GET', '/drivers')),
  createDriver: async (data: CreateDriverRequest): Promise<AdminDriver> => must(toDriver(await call('POST', '/drivers', data))),
  updateDriver: async (id: number, data: UpdateDriverRequest): Promise<AdminDriver> =>
    must(toDriver(await call('PATCH', `/drivers/${id}`, data))),
  setDriverBlocked: async (id: number, blocked: boolean): Promise<AdminDriver> =>
    must(toDriver(await call('PATCH', `/drivers/${id}/status`, { is_blocked: blocked }))),

  // Orders
  orders: async (page = 1, limit = 50): Promise<Paged<OrderView>> => toPaged(await call('GET', `/orders?${pageQuery(page, limit)}`), toOrder),
  order: async (id: number): Promise<OrderView> => must(toOrder(await call('GET', `/orders/${id}`))),
  history: async (id: number): Promise<HistoryEntry[]> => toHistoryList(await call('GET', `/orders/${id}/history`)),
  createOrder: async (clientId: number, order: CreateOrderRequest): Promise<OrderView> =>
    must(toOrder(await call('POST', '/orders', { client_id: clientId, order }))),
  estimate: async (order: CreateOrderRequest): Promise<Estimate> => must(toEstimate(await call('POST', '/orders/estimate', order))),
  assignDriver: async (id: number, driverId: number): Promise<OrderView> =>
    must(toOrder(await call('POST', `/orders/${id}/assign-driver`, { driver_id: driverId }))),
  cancelOrder: async (id: number, reason: string | null): Promise<OrderView> =>
    must(toOrder(await call('POST', `/orders/${id}/cancel`, { reason }))),
  acceptOrder: async (id: number, driverId: number): Promise<OrderView> =>
    must(toOrder(await call('POST', `/orders/${id}/accept`, { driver_id: driverId }))),
  markArrived: async (id: number): Promise<OrderView> => must(toOrder(await call('POST', `/orders/${id}/arrived`))),
  startTrip: async (id: number): Promise<TripView | null> => toTrip(await call('POST', `/orders/${id}/start`, { shift_id: 0 })),
  completeTrip: async (id: number, distanceKm: number | null): Promise<TripView | null> =>
    toTrip(await call('POST', `/orders/${id}/complete`, { distance_km: distanceKm })),

  // Trips
  trips: async (page = 1, limit = 50): Promise<Paged<TripView>> => toPaged(await call('GET', `/trips?${pageQuery(page, limit)}`), toTrip),

  // Tariffs
  tariffs: async (): Promise<AdminTariff[]> => toAdminTariffs(await call('GET', '/tariffs')),
  createTariff: async (data: TariffRequest): Promise<AdminTariff> => must(toAdminTariff(await call('POST', '/tariffs', data))),
  updateTariff: async (id: number, data: TariffRequest): Promise<AdminTariff> =>
    must(toAdminTariff(await call('PATCH', `/tariffs/${id}`, data))),
  setTariffActive: async (id: number, active: boolean): Promise<AdminTariff> =>
    must(toAdminTariff(await call('PATCH', `/tariffs/${id}/status`, { is_active: active }))),

  // Promocodes
  promocodes: async (): Promise<Promocode[]> => toPromocodes(await call('GET', '/promocodes')),
  createPromocode: async (data: PromocodeRequest): Promise<Promocode> => must(toPromocode(await call('POST', '/promocodes', data))),
  updatePromocode: async (id: number, data: PromocodeRequest): Promise<Promocode> =>
    must(toPromocode(await call('PATCH', `/promocodes/${id}`, data))),
  setPromocodeActive: async (id: number, active: boolean): Promise<Promocode> =>
    must(toPromocode(await call('PATCH', `/promocodes/${id}/status`, { is_active: active }))),
}
