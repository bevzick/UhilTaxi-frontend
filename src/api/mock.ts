import { ApiError } from './http'
import { distanceMeters } from '@/utils/geo'
import type { AuthResponse, LoginRequest, RegisterRequest, UserResponse } from '@/types/auth'
import type { CancelOrderRequest, CompleteTripRequest, CreateOrderRequest } from '@/types/order'

export const MOCK_API = import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true'

/** In demo mode, logging in with these phones gives the driver / admin role. */
export const MOCK_DRIVER_PHONE = '+380990000001'
export const MOCK_ADMIN_PHONE = '+380990000002'

if (MOCK_API) {
  console.warn(
    `[UhilTaxi] Демо-режим: запити до API підмінено фейковими відповідями. Водій: ${MOCK_DRIVER_PHONE}, адмін: ${MOCK_ADMIN_PHONE}`,
  )
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toISOString()
const STORE_KEY = 'uhiltaxi.mock.v2'

// Client-side timeline: how long each stage lasts before the fake backend moves the order on.
const SEARCH_MS = 6_000
const TO_PICKUP_MS = 25_000
const WAIT_MS = 12_000
const RIDE_MS = 25_000

type Row = Record<string, unknown> & { id: number }
type WireOrder = Row & { status: string; created_at: string }

interface Store {
  seq: number
  orders: WireOrder[]
  driverOrders: WireOrder[]
  trips: Row[]
  driverPick: number
  clients: Row[]
  drivers: Row[]
  tariffs: Row[]
  promos: Row[]
}

const PLACES = [
  { address: 'Залізничний вокзал, вулиця Шевченка', lat: 49.418024, lng: 27.010897 },
  { address: 'Автовокзал №1, Вінницьке шосе, 23', lat: 49.432354, lng: 27.025776 },
  { address: 'майдан Незалежності', lat: 49.419664, lng: 26.979381 },
  { address: 'ТРЦ «Оазис», вулиця Степана Бандери, 2а', lat: 49.432811, lng: 26.983998 },
  { address: 'Обласна лікарня, вулиця Гетьмана Мазепи', lat: 49.412308, lng: 27.002948 },
  { address: 'Проскурівська вулиця, Кавказ', lat: 49.421366, lng: 26.99149 },
  { address: 'Автовокзал №2, вулиця Шевченка', lat: 49.416576, lng: 27.013347 },
  { address: 'Оазис, Інститутська вулиця, 10', lat: 49.409422, lng: 26.960378 },
]

function seed(): Store {
  const driver = (id: number, first: string, last: string, phone: string, rating: number, count: number, car: string, plate: string, license: string, hire: string) => ({
    id, first_name: first, last_name: last, phone, email: `${last.toLowerCase()}@uhiltaxi.ua`, role: 'Driver', status: 'active',
    license_number: license, hire_date: hire, rating_average: rating, rating_count: count, car_model: car, car_plate: plate,
  })
  const client = (id: number, first: string, last: string, phone: string, email: string, birth: string | null) => ({
    id, first_name: first, last_name: last, phone, email, status: 'active', birth_date: birth, rating_average: 4.5 + (id % 5) / 10, rating_count: 5 + id * 3,
  })
  return {
    seq: 4000,
    orders: [],
    driverOrders: [],
    trips: [],
    driverPick: 0,
    drivers: [
      driver(7, 'Олександр', 'Коваль', MOCK_DRIVER_PHONE, 4.92, 418, 'Toyota Camry', 'BX 4521 KA', 'ВХК 182934', '2022-03-14'),
      driver(12, 'Ірина', 'Мельник', '+380501234502', 4.97, 1203, 'Škoda Octavia', 'BX 1187 AM', 'ВХА 551209', '2020-09-01'),
      driver(19, 'Тарас', 'Бондар', '+380931234503', 4.61, 87, 'Hyundai Ioniq', 'BX 9034 EE', 'ВХС 330871', '2025-01-20'),
      driver(23, 'Віктор', 'Гнатюк', '+380971234504', 4.83, 356, 'Kia Ceed SW', 'BX 6610 HB', 'ВХМ 774412', '2021-06-07'),
    ],
    clients: [
      client(1, 'Тестовий', 'Користувач', '+380971234567', 'test@uhiltaxi.ua', '1999-04-12'),
      client(101, 'Марія', 'Шевчук', '+380671110001', 'maria.sh@gmail.com', '2001-11-03'),
      client(102, 'Андрій', 'Лисенко', '+380501110002', 'lysenko.a@ukr.net', '1987-02-21'),
      client(103, 'Оксана', 'Кравець', '+380931110003', 'oksana.k@gmail.com', null),
      client(104, 'Дмитро', 'Савчук', '+380971110004', 'd.savchuk@gmail.com', '1995-07-30'),
      client(105, 'Юлія', 'Ткачук', '+380661110005', 'yulia.t@ukr.net', '2003-05-18'),
    ],
    tariffs: [
      { id: 1, name: 'Economy', service_class: 'economy', base_fare: 45, rate_per_km: 14, rate_per_min: 2, is_active: true },
      { id: 2, name: 'Comfort', service_class: 'comfort', base_fare: 65, rate_per_km: 18, rate_per_min: 3, is_active: true },
      { id: 3, name: 'Business', service_class: 'business', base_fare: 110, rate_per_km: 27, rate_per_min: 4.5, is_active: true },
    ],
    promos: [
      { id: 1, code: 'UHIL20', discount_value: 20, discount_type: 'percent', expiry_date: '2027-12-31', max_uses: 500, uses_count: 37, is_active: true, min_order_amount: 60, max_discount_amount: 80, created_at: now(), updated_at: now() },
      { id: 2, code: 'HACK50', discount_value: 50, discount_type: 'fixed', expiry_date: '2026-12-31', max_uses: 100, uses_count: 12, is_active: true, min_order_amount: 100, max_discount_amount: null, created_at: now(), updated_at: now() },
      { id: 3, code: 'SUMMER25', discount_value: 25, discount_type: 'percent', expiry_date: '2026-08-31', max_uses: 200, uses_count: 200, is_active: false, min_order_amount: null, max_discount_amount: 60, created_at: now(), updated_at: now() },
    ],
  }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return { ...seed(), ...(JSON.parse(raw) as Partial<Store>) }
  } catch {
    // fall through to a fresh store
  }
  return seed()
}

const store = load()

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    return
  }
}

const nextId = (rows: Row[]) => rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
const isBlocked = (row: Row | undefined) => row?.status === 'blocked'

let profile: UserResponse = {
  id: 1,
  first_name: 'Тестовий',
  last_name: 'Користувач',
  phone: '+380971234567',
  email: 'test@uhiltaxi.ua',
  role: 'Client',
  status: 'active',
  birth_date: null,
}

function quote(tariffId: number, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const tariff = store.tariffs.find((item) => item.id === tariffId && item.is_active !== false)
  if (!tariff) throw new ApiError('Тариф недоступний', 400)
  const km = Math.round(((distanceMeters(from, to) * 1.35) / 1000) * 10) / 10
  const min = Math.max(4, Math.round((km / 28) * 60))
  const fare = Math.round(Number(tariff.base_fare) + Number(tariff.rate_per_km) * km + Number(tariff.rate_per_min) * min)
  return { tariff, km, min, fare }
}

function discountFor(code: string | null, amount: number) {
  if (!code) return 0
  const promo = store.promos.find((item) => String(item.code).toUpperCase() === code.toUpperCase())
  const expired = promo && Date.parse(`${String(promo.expiry_date)}T23:59:59`) < Date.now()
  if (!promo || promo.is_active === false || expired || Number(promo.uses_count) >= Number(promo.max_uses)) {
    throw new ApiError('Промокод недійсний або прострочений', 400)
  }
  if (promo.min_order_amount && amount < Number(promo.min_order_amount)) {
    throw new ApiError(`Промокод діє від ${String(promo.min_order_amount)} ₴`, 400)
  }
  const raw = promo.discount_type === 'percent' ? (amount * Number(promo.discount_value)) / 100 : Number(promo.discount_value)
  const capped = promo.max_discount_amount ? Math.min(raw, Number(promo.max_discount_amount)) : raw
  return Math.round(Math.min(capped, amount))
}

function orderFrom(data: CreateOrderRequest, extra: Record<string, unknown>): WireOrder {
  const { km, min, fare } = quote(data.tariff_id, data.pickup, data.destination)
  const discount = discountFor(data.promocode, fare)
  if (discount) {
    const promo = store.promos.find((item) => String(item.code).toUpperCase() === data.promocode?.toUpperCase())
    if (promo) promo.uses_count = Number(promo.uses_count) + 1
  }
  return {
    id: ++store.seq,
    client_id: profile.id,
    tariff_id: data.tariff_id,
    assigned_driver_id: null,
    status: 'pending',
    pickup_address: data.pickup.address,
    pickup_lat: data.pickup.lat,
    pickup_lng: data.pickup.lng,
    destination_address: data.destination.address,
    destination_lat: data.destination.lat,
    destination_lng: data.destination.lng,
    estimated_distance_km: km,
    estimated_duration_min: min,
    estimated_fare: fare - discount,
    created_at: now(),
    updated_at: now(),
    ...extra,
  }
}

function attachDriver(order: WireOrder, driverId: number) {
  const driver = store.drivers.find((item) => item.id === driverId)
  if (!driver) throw new ApiError('Водія не знайдено', 404)
  if (isBlocked(driver)) throw new ApiError('Цей водій заблокований', 409)
  Object.assign(order, { assigned_driver_id: driver.id, driver: { ...driver } })
}

/** Moves a client's order through the fake timeline based on elapsed time. */
function advance(order: WireOrder) {
  const at = (key: string) => (typeof order[key] === 'string' ? Date.parse(order[key] as string) : 0)
  const elapsed = (key: string) => Date.now() - at(key)

  if (order.status === 'pending' && elapsed('created_at') > SEARCH_MS) {
    const pool = store.drivers.filter((item) => !isBlocked(item))
    if (!pool.length) return
    const driver = pool[store.driverPick++ % pool.length]!
    attachDriver(order, driver.id)
    Object.assign(order, { status: 'accepted', accepted_at: now() })
  } else if (order.status === 'accepted' && elapsed('accepted_at') > TO_PICKUP_MS) {
    Object.assign(order, { status: 'driver_arrived', arrived_at: now() })
  } else if (order.status === 'driver_arrived' && elapsed('arrived_at') > WAIT_MS) {
    Object.assign(order, { status: 'in_progress', started_at: now() })
  } else if (order.status === 'in_progress' && elapsed('started_at') > RIDE_MS) {
    Object.assign(order, { status: 'completed', completed_at: now() })
    store.trips.unshift(tripFor(order))
  } else {
    return
  }
  order.updated_at = now()
  save()
}

function tripFor(order: WireOrder, distanceKm?: number | null): Row {
  const tariff = store.tariffs.find((item) => item.id === order.tariff_id)
  return {
    id: order.id,
    order_id: order.id,
    shift_id: 1,
    actual_start_time: order.started_at ?? now(),
    actual_end_time: now(),
    distance_km: distanceKm ?? order.estimated_distance_km,
    duration_min: order.estimated_duration_min,
    tariff_name: tariff?.name ?? null,
    base_fare: tariff?.base_fare ?? 0,
    rate_per_km: tariff?.rate_per_km ?? 0,
    rate_per_min: tariff?.rate_per_min ?? 0,
    discount_amount: 0,
    final_fare: order.estimated_fare,
  }
}

function seedDriverOrders() {
  if (store.driverOrders.some((order) => order.status === 'pending')) return
  const minutesAgo = [1, 3, 4, 7, 12]
  store.clients.slice(1, 6).forEach((client, index) => {
    const from = PLACES[index % PLACES.length]!
    const to = PLACES[(index + 3) % PLACES.length]!
    const order = orderFrom(
      { tariff_id: Number(store.tariffs[index % store.tariffs.length]?.id ?? 1), pickup: from, destination: to, promocode: null },
      { client_id: client.id, client: { ...client }, created_at: new Date(Date.now() - minutesAgo[index]! * 60_000).toISOString() },
    )
    store.driverOrders.push(order)
  })
  save()
}

const allOrders = () => [...store.orders, ...store.driverOrders]

function findAny(id: number) {
  const order = allOrders().find((item) => item.id === id)
  if (!order) throw new ApiError('Замовлення не знайдено', 404)
  return order
}

function findOwn(id: number) {
  const order = store.orders.find((item) => item.id === id)
  if (!order) throw new ApiError('Замовлення не знайдено', 404)
  return order
}

function findDriver(id: number) {
  const order = store.driverOrders.find((item) => item.id === id)
  if (!order) throw new ApiError('Замовлення не знайдено', 404)
  return order
}

function step(order: WireOrder, from: string[], to: string, stamp: string) {
  if (!from.includes(order.status)) throw new ApiError('Неможливо змінити статус цього замовлення', 409)
  Object.assign(order, { status: to, [stamp]: now(), updated_at: now() })
  save()
  return { ...order }
}

function historyOf(order: WireOrder) {
  const steps: [string, string, string][] = [
    ['created_at', '', 'pending'],
    ['accepted_at', 'pending', 'accepted'],
    ['arrived_at', 'accepted', 'driver_arrived'],
    ['started_at', 'driver_arrived', 'in_progress'],
    ['completed_at', 'in_progress', 'completed'],
  ]
  const list: Record<string, unknown>[] = steps
    .filter(([key]) => typeof order[key] === 'string')
    .map(([key, from, to], index) => ({
      id: index + 1,
      from_status: from,
      to_status: to,
      changed_by_user_id: to === 'pending' ? order.client_id : order.assigned_driver_id ?? 0,
      reason: null,
      created_at: order[key],
    }))
  if (typeof order.cancelled_at === 'string') {
    list.push({
      id: list.length + 1,
      from_status: list.at(-1)?.to_status ?? 'pending',
      to_status: 'cancelled',
      changed_by_user_id: (order.cancelled_by_user_id as number) ?? 0,
      reason: (order.cancellation_reason as string) ?? null,
      created_at: order.cancelled_at,
    })
  }
  return list
}

const session = (): AuthResponse => ({
  access_token: `mock-token-${Date.now()}`,
  expires_in: 60 * 60 * 8,
  user: { ...profile },
})

const paged = (rows: unknown[], page = 1, limit = 50) => ({
  data: rows.slice((page - 1) * limit, page * limit),
  pagination: { page, limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / limit)) },
})

export const mockApi = {
  async login(data: LoginRequest): Promise<AuthResponse> {
    await delay(700)
    if (data.password === 'wrong') throw new ApiError('Невірний телефон або пароль', 401)
    if (data.phone === '+380000000000') throw new ApiError('Сервер тимчасово недоступний. Спробуйте пізніше', 500)

    if (data.phone === MOCK_ADMIN_PHONE) {
      profile = { id: 900, first_name: 'Адміністратор', last_name: 'UhilTaxi', phone: data.phone, email: 'admin@uhiltaxi.ua', role: 'Admin', status: 'active', birth_date: null }
      return session()
    }

    const driver = store.drivers.find((item) => item.phone === data.phone)
    const client = store.clients.find((item) => item.phone === data.phone)
    const account = driver ?? client
    if (isBlocked(account)) throw new ApiError('Акаунт заблоковано. Зверніться в підтримку', 403)

    if (driver) {
      profile = { id: driver.id, first_name: String(driver.first_name), last_name: String(driver.last_name), phone: data.phone, email: String(driver.email ?? ''), role: 'Driver', status: 'active', birth_date: null }
    } else if (client) {
      profile = { id: client.id, first_name: String(client.first_name), last_name: String(client.last_name), phone: data.phone, email: String(client.email ?? ''), role: 'Client', status: 'active', birth_date: (client.birth_date as string) ?? null }
    } else {
      const id = Math.max(nextId(store.clients), 200)
      store.clients.push({ id, first_name: 'Новий', last_name: 'Клієнт', phone: data.phone, email: null, status: 'active', birth_date: null })
      save()
      profile = { id, first_name: 'Новий', last_name: 'Клієнт', phone: data.phone, email: null, role: 'Client', status: 'active', birth_date: null }
    }
    return session()
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    await delay(900)
    if ([...store.clients, ...store.drivers].some((item) => item.phone === data.phone)) {
      throw new ApiError('Користувач з таким номером вже існує', 409)
    }
    const id = Math.max(nextId(store.clients), 200)
    store.clients.push({ id, first_name: data.first_name, last_name: data.last_name, phone: data.phone, email: data.email, status: 'active', birth_date: data.birth_date })
    save()
    profile = { id, first_name: data.first_name, last_name: data.last_name, phone: data.phone, email: data.email, role: 'Client', status: 'active', birth_date: data.birth_date }
    return session()
  },

  async tariffs(): Promise<unknown> {
    await delay(300)
    return store.tariffs.filter((item) => item.is_active !== false)
  },

  async estimate(data: CreateOrderRequest): Promise<unknown> {
    await delay(350)
    const { km, min, fare } = quote(data.tariff_id, data.pickup, data.destination)
    const discount = discountFor(data.promocode, fare)
    return { distance_km: km, duration_min: min, base_amount: fare, discount_amount: discount, estimated_fare: fare - discount }
  },

  async createOrder(data: CreateOrderRequest): Promise<unknown> {
    await delay(900)
    const order = orderFrom(data, {})
    store.orders.push(order)
    save()
    return { ...order }
  },

  async getOrder(id: number): Promise<unknown> {
    await delay(200)
    const order = findOwn(id)
    advance(order)
    return { ...order }
  },

  async cancelOrder(id: number, body: CancelOrderRequest): Promise<unknown> {
    await delay(500)
    const order = findOwn(id)
    if (!['pending', 'accepted', 'driver_arrived'].includes(order.status)) {
      throw new ApiError('Поїздку вже не можна скасувати', 409)
    }
    Object.assign(order, { cancellation_reason: body.reason, cancelled_by_user_id: profile.id })
    return step(order, [order.status], 'cancelled', 'cancelled_at')
  },

  async driverAvailable(): Promise<unknown> {
    await delay(400)
    seedDriverOrders()
    return paged(store.driverOrders.filter((order) => order.status === 'pending'), 1, 20)
  },

  async driverAssigned(): Promise<unknown> {
    await delay(300)
    return paged(
      store.driverOrders.filter(
        (order) => order.assigned_driver_id === profile.id && ['accepted', 'driver_arrived', 'in_progress'].includes(order.status),
      ),
      1,
      20,
    )
  },

  async driverGet(id: number): Promise<unknown> {
    await delay(200)
    return { ...findDriver(id) }
  },

  async driverAccept(id: number): Promise<unknown> {
    await delay(700)
    const order = findDriver(id)
    if (order.status !== 'pending') throw new ApiError('Це замовлення вже прийняв інший водій', 409)
    if (store.drivers.some((item) => item.id === profile.id)) attachDriver(order, profile.id)
    else order.assigned_driver_id = profile.id
    return step(order, ['pending'], 'accepted', 'accepted_at')
  },

  async driverArrived(id: number): Promise<unknown> {
    await delay(500)
    return step(findDriver(id), ['accepted'], 'driver_arrived', 'arrived_at')
  },

  async driverStart(id: number): Promise<unknown> {
    await delay(500)
    const order = step(findDriver(id), ['driver_arrived'], 'in_progress', 'started_at')
    return { id: order.id, order_id: order.id, shift_id: 1, actual_start_time: now() }
  },

  async driverComplete(id: number, body: CompleteTripRequest): Promise<unknown> {
    await delay(700)
    const order = findDriver(id)
    step(order, ['in_progress'], 'completed', 'completed_at')
    const trip = tripFor(order, body.distance_km)
    store.trips.unshift(trip)
    save()
    return trip
  },

  async driverTrips(): Promise<unknown> {
    await delay(300)
    return paged(store.trips, 1, 30)
  },
}

/** Fake implementation of the /api/v1/admin/* surface, routed by method + path. */
export const mockAdmin = {
  async handle(method: string, path: string, body: unknown): Promise<unknown> {
    await delay(method === 'GET' ? 300 : 550)
    const data = (body ?? {}) as Record<string, unknown>
    const [route = '', query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    const parts = route.split('/').filter(Boolean)
    const [section, rawId, action] = parts
    const id = Number(rawId)
    const touch = (row: Row, patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) if (value !== null && value !== undefined) row[key] = value
      if ('updated_at' in row) row.updated_at = now()
      save()
      return { ...row }
    }
    const find = (rows: Row[], what: string) => {
      const row = rows.find((item) => item.id === id)
      if (!row) throw new ApiError(`${what} не знайдено`, 404)
      return row
    }

    switch (section) {
      case 'clients': {
        if (!rawId) return store.clients.map((row) => ({ ...row }))
        const row = find(store.clients, 'Клієнта')
        if (action === 'status') return touch(row, { status: data.is_blocked ? 'blocked' : 'active' })
        return { ...row }
      }

      case 'drivers': {
        if (!rawId && method === 'POST') {
          if (store.drivers.some((item) => item.phone === data.phone)) {
            throw new ApiError('Водій з таким номером вже існує', 409)
          }
          const row: Row = { id: Math.max(nextId(store.drivers), 30), role: 'Driver', status: 'active', rating_average: 0, rating_count: 0, ...data }
          delete row.password
          store.drivers.push(row)
          save()
          return { ...row }
        }
        if (!rawId) return store.drivers.map((row) => ({ ...row }))
        const row = find(store.drivers, 'Водія')
        if (action === 'status') return touch(row, { status: data.is_blocked ? 'blocked' : 'active' })
        if (method === 'PATCH') return touch(row, data)
        return { ...row }
      }

      case 'tariffs': {
        if (!rawId && method === 'POST') {
          const row: Row = { id: nextId(store.tariffs), is_active: true, ...data }
          store.tariffs.push(row)
          save()
          return { ...row }
        }
        if (!rawId) return store.tariffs.map((row) => ({ ...row }))
        const row = find(store.tariffs, 'Тариф')
        if (action === 'status') return touch(row, { is_active: data.is_active === true })
        if (method === 'PATCH') return touch(row, data)
        return { ...row }
      }

      case 'promocodes': {
        if (!rawId && method === 'POST') {
          const code = String(data.code ?? '').toUpperCase()
          if (store.promos.some((item) => String(item.code).toUpperCase() === code)) throw new ApiError('Такий промокод вже існує', 409)
          const row: Row = { id: nextId(store.promos), uses_count: 0, is_active: true, created_at: now(), updated_at: now(), ...data, code }
          store.promos.push(row)
          save()
          return { ...row }
        }
        if (!rawId) return store.promos.map((row) => ({ ...row }))
        const row = find(store.promos, 'Промокод')
        if (action === 'status') return touch(row, { is_active: data.is_active === true })
        if (method === 'PATCH') return touch(row, { ...data, code: data.code ? String(data.code).toUpperCase() : null })
        return { ...row }
      }

      case 'trips': {
        if (rawId) return { ...find(store.trips, 'Поїздку') }
        return paged(store.trips, Number(params.get('page') ?? 1), Number(params.get('limit') ?? 50))
      }

      case 'orders': {
        if (rawId === 'estimate') return mockApi.estimate(data as unknown as CreateOrderRequest)
        if (!rawId && method === 'POST') {
          const clientId = Number(data.client_id)
          const client = store.clients.find((item) => item.id === clientId)
          if (!client) throw new ApiError('Клієнта не знайдено', 404)
          if (isBlocked(client)) throw new ApiError('Клієнт заблокований', 409)
          const order = orderFrom(data.order as CreateOrderRequest, { client_id: clientId, client: { ...client } })
          store.driverOrders.push(order)
          save()
          return { ...order }
        }
        if (!rawId) {
          store.orders.forEach(advance)
          seedDriverOrders()
          const rows = allOrders().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          return paged(rows, Number(params.get('page') ?? 1), Number(params.get('limit') ?? 50))
        }

        const order = findAny(id)
        switch (action) {
          case undefined:
            return { ...order }
          case 'history':
            return historyOf(order)
          case 'assign-driver':
          case 'accept': {
            if (!['pending', 'accepted'].includes(order.status)) throw new ApiError('Водія вже не можна змінити', 409)
            attachDriver(order, Number(data.driver_id))
            return step(order, [order.status], 'accepted', 'accepted_at')
          }
          case 'cancel':
            Object.assign(order, { cancellation_reason: data.reason ?? null, cancelled_by_user_id: profile.id })
            return step(order, ['pending', 'accepted', 'driver_arrived', 'in_progress'], 'cancelled', 'cancelled_at')
          case 'arrived':
            return step(order, ['accepted'], 'driver_arrived', 'arrived_at')
          case 'start': {
            step(order, ['driver_arrived'], 'in_progress', 'started_at')
            return { id: order.id, order_id: order.id, shift_id: 1, actual_start_time: now() }
          }
          case 'complete': {
            step(order, ['in_progress'], 'completed', 'completed_at')
            const trip = tripFor(order, (data.distance_km as number | null) ?? null)
            store.trips.unshift(trip)
            save()
            return trip
          }
        }
        break
      }
    }
    throw new ApiError('Не знайдено', 404)
  },
}
