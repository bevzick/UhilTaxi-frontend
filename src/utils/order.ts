import { clean } from '@/utils/validation'
import type { Estimate, OrderStage, OrderView, Paged, Person, Tariff, TripView } from '@/types/order'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown, max = 200) =>
  typeof value === 'string' ? clean(value).replace(/\s+/g, ' ').trim().slice(0, max) : ''

const textOrNull = (value: unknown, max = 200) => text(value, max) || null

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function id(value: unknown): number | null {
  const n = num(value)
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null
}

const date = (value: unknown) => {
  const raw = text(value, 40)
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null
}

const STAGES: [OrderStage, string[]][] = [
  ['cancelled', ['cancel', 'reject', 'expired']],
  ['completed', ['complete', 'finish', 'done', 'paid']],
  ['started', ['start', 'progress', 'trip', 'ride', 'ongoing']],
  ['arrived', ['arriv']],
  ['accepted', ['accept', 'assign', 'confirm', 'enroute', 'onway']],
]

export function toStage(status: string): OrderStage {
  const key = status.toLowerCase().replace(/[^a-z]/g, '')
  for (const [stage, hints] of STAGES) if (hints.some((hint) => key.includes(hint))) return stage
  return 'searching'
}

export const isFinal = (stage: OrderStage) => stage === 'completed' || stage === 'cancelled'

function toPerson(value: unknown, fallbackId: number | null): Person | null {
  if (!isRecord(value)) return null
  const firstName = text(value.first_name ?? value.firstName, 60)
  const lastName = text(value.last_name ?? value.lastName, 60)
  if (!firstName && !lastName) return null
  const vehicle = isRecord(value.vehicle) ? value.vehicle : isRecord(value.car) ? value.car : {}

  return {
    id: id(value.id) ?? fallbackId,
    firstName,
    lastName,
    phone: textOrNull(value.phone, 20),
    rating: num(value.rating_average ?? value.rating),
    ratingCount: Math.max(0, Math.round(num(value.rating_count) ?? 0)),
    car:
      textOrNull(value.car_model ?? value.vehicle_model, 60) ??
      (textOrNull([text(vehicle.brand ?? vehicle.make, 30), text(vehicle.model, 30)].filter(Boolean).join(' '), 60) ||
        null),
    plate: textOrNull(value.car_plate ?? value.plate_number ?? vehicle.plate ?? vehicle.plate_number, 16),
  }
}

export function toOrder(value: unknown): OrderView | null {
  if (!isRecord(value)) return null
  const orderId = id(value.id)
  if (orderId === null) return null

  const status = text(value.status, 40) || 'searching'
  const driverId = id(value.assigned_driver_id ?? value.driver_id)
  const clientId = id(value.client_id)

  return {
    id: orderId,
    stage: toStage(status),
    status,
    clientId,
    tariffId: id(value.tariff_id),
    driverId,
    pickup: {
      address: text(value.pickup_address) || 'Адреса посадки',
      lat: num(value.pickup_lat) ?? 0,
      lng: num(value.pickup_lng) ?? 0,
    },
    destination: {
      address: text(value.destination_address) || 'Пункт призначення',
      lat: num(value.destination_lat) ?? 0,
      lng: num(value.destination_lng) ?? 0,
    },
    distanceKm: num(value.estimated_distance_km),
    durationMin: num(value.estimated_duration_min),
    fare: num(value.estimated_fare),
    cancellationReason: textOrNull(value.cancellation_reason),
    createdAt: date(value.created_at),
    acceptedAt: date(value.accepted_at),
    driver: toPerson(value.driver ?? value.assigned_driver, driverId),
    client: toPerson(value.client, clientId),
  }
}

export function toTariffs(value: unknown): Tariff[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Tariff[] => {
    if (!isRecord(item) || item.is_active === false) return []
    const tariffId = id(item.id)
    if (tariffId === null) return []
    return [
      {
        id: tariffId,
        name: text(item.name, 50) || `Тариф ${tariffId}`,
        serviceClass: text(item.service_class, 30).toLowerCase(),
        baseFare: num(item.base_fare) ?? 0,
        ratePerKm: num(item.rate_per_km) ?? 0,
        ratePerMin: num(item.rate_per_min) ?? 0,
      },
    ]
  })
}

export function toEstimate(value: unknown): Estimate | null {
  if (!isRecord(value)) return null
  const fare = num(value.estimated_fare)
  if (fare === null) return null
  return {
    distanceKm: num(value.distance_km) ?? 0,
    durationMin: Math.round(num(value.duration_min) ?? 0),
    baseAmount: num(value.base_amount) ?? fare,
    discountAmount: num(value.discount_amount) ?? 0,
    fare,
  }
}

export function toTrip(value: unknown): TripView | null {
  if (!isRecord(value)) return null
  const tripId = id(value.id)
  if (tripId === null) return null
  return {
    id: tripId,
    orderId: id(value.order_id),
    distanceKm: num(value.distance_km),
    durationMin: num(value.duration_min),
    fare: num(value.final_fare),
    tariffName: textOrNull(value.tariff_name, 50),
    startedAt: date(value.actual_start_time),
    endedAt: date(value.actual_end_time),
  }
}

export function toPaged<T>(value: unknown, map: (item: unknown) => T | null): Paged<T> {
  const list = isRecord(value) ? value.data : value
  const pagination = isRecord(value) && isRecord(value.pagination) ? value.pagination : {}
  const data = Array.isArray(list) ? list.map(map).filter((item): item is T => item !== null) : []
  return {
    data,
    page: id(pagination.page) ?? 1,
    pages: id(pagination.pages) ?? 1,
    total: Math.max(data.length, Math.round(num(pagination.total) ?? 0)),
  }
}

const money = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })

export const formatFare = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${money.format(Math.round(value))} ₴`

export const formatKm = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} км`

export const fullName = (person: Person | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : ''

export const initials = (person: Person | null, fallback = 'U') =>
  person ? (person.firstName.charAt(0) + person.lastName.charAt(0)).toUpperCase() || fallback : fallback

export function timeAgo(iso: string | null) {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'щойно'
  if (minutes < 60) return `${minutes} хв тому`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} год тому` : new Date(iso).toLocaleDateString('uk-UA')
}

export const STAGE_LABEL: Record<OrderStage, string> = {
  searching: 'Шукаємо водія',
  accepted: 'Водій їде до вас',
  arrived: 'Водій на місці',
  started: 'У дорозі',
  completed: 'Поїздку завершено',
  cancelled: 'Скасовано',
}
