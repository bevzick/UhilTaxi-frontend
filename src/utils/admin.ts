import { clean } from '@/utils/validation'
import type { AdminClient, AdminDriver, AdminTariff, HistoryEntry, Promocode } from '@/types/admin'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown, max = 200) =>
  typeof value === 'string' ? clean(value).replace(/\s+/g, ' ').trim().slice(0, max) : ''

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function id(value: unknown): number | null {
  const n = num(value)
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null
}

const day = (value: unknown) => {
  const raw = text(value, 40)
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
}

const stamp = (value: unknown) => {
  const raw = text(value, 40)
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null
}

/** Status strings aren't enumerated in swagger; anything mentioning "block"/"ban" counts as blocked. */
export const isBlockedStatus = (status: string) => /block|ban|disabl|suspend|inactive/i.test(status)

const list = <T>(value: unknown, map: (item: unknown) => T | null): T[] =>
  (Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : [])
    .map(map)
    .filter((item): item is T => item !== null)

export function toClient(value: unknown): AdminClient | null {
  if (!isRecord(value)) return null
  const clientId = id(value.id)
  if (clientId === null) return null
  const status = text(value.status, 40) || 'active'
  return {
    id: clientId,
    firstName: text(value.first_name, 60),
    lastName: text(value.last_name, 60),
    phone: text(value.phone, 20),
    email: text(value.email, 254),
    status,
    blocked: value.is_blocked === true || isBlockedStatus(status),
    birthDate: day(value.birth_date),
  }
}

export function toDriver(value: unknown): AdminDriver | null {
  const base = toClient(value)
  if (!base || !isRecord(value)) return null
  return {
    ...base,
    licenseNumber: text(value.license_number, 30),
    hireDate: day(value.hire_date),
    rating: num(value.rating_average),
    ratingCount: Math.max(0, Math.round(num(value.rating_count) ?? 0)),
  }
}

export function toAdminTariff(value: unknown): AdminTariff | null {
  if (!isRecord(value)) return null
  const tariffId = id(value.id)
  if (tariffId === null) return null
  return {
    id: tariffId,
    name: text(value.name, 50) || `Тариф ${tariffId}`,
    serviceClass: text(value.service_class, 30),
    baseFare: num(value.base_fare) ?? 0,
    ratePerKm: num(value.rate_per_km) ?? 0,
    ratePerMin: num(value.rate_per_min) ?? 0,
    active: value.is_active !== false,
  }
}

export function toPromocode(value: unknown): Promocode | null {
  if (!isRecord(value)) return null
  const promoId = id(value.id)
  if (promoId === null) return null
  return {
    id: promoId,
    code: text(value.code, 32),
    discountValue: num(value.discount_value) ?? 0,
    discountType: text(value.discount_type, 20).toLowerCase() || 'percent',
    expiryDate: day(value.expiry_date),
    maxUses: Math.max(0, Math.round(num(value.max_uses) ?? 0)),
    usesCount: Math.max(0, Math.round(num(value.uses_count) ?? 0)),
    active: value.is_active !== false,
    minOrderAmount: num(value.min_order_amount),
    maxDiscountAmount: num(value.max_discount_amount),
  }
}

export function toHistory(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null
  const entryId = id(value.id)
  if (entryId === null) return null
  return {
    id: entryId,
    fromStatus: text(value.from_status, 40),
    toStatus: text(value.to_status, 40),
    changedBy: id(value.changed_by_user_id),
    reason: text(value.reason) || null,
    at: stamp(value.created_at),
  }
}

export const toClients = (value: unknown) => list(value, toClient)
export const toDrivers = (value: unknown) => list(value, toDriver)
export const toAdminTariffs = (value: unknown) => list(value, toAdminTariff)
export const toPromocodes = (value: unknown) => list(value, toPromocode)
export const toHistoryList = (value: unknown) =>
  list(value, toHistory).sort((a, b) => (a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : a.id - b.id))

export const personName = (person: { firstName: string; lastName: string; id: number }, fallback = 'Користувач') =>
  [person.firstName, person.lastName].filter(Boolean).join(' ') || `${fallback} №${person.id}`

export const isPercent = (type: string) => /perc|%|pct/i.test(type)

export const formatDiscount = (promo: Pick<Promocode, 'discountValue' | 'discountType'>) =>
  isPercent(promo.discountType) ? `−${promo.discountValue}%` : `−${Math.round(promo.discountValue)} ₴`

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('uk-UA') : '—'

export const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
