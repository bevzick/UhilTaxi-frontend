// Admin-side view models, narrowed from swagger-final.json responses by utils/admin.ts.

export interface AdminClient {
  id: number
  firstName: string
  lastName: string
  phone: string
  email: string
  status: string
  blocked: boolean
  birthDate: string | null
}

export interface AdminDriver extends AdminClient {
  licenseNumber: string
  hireDate: string | null
  rating: number | null
  ratingCount: number
}

export interface AdminTariff {
  id: number
  name: string
  serviceClass: string
  baseFare: number
  ratePerKm: number
  ratePerMin: number
  active: boolean
}

export interface Promocode {
  id: number
  code: string
  discountValue: number
  discountType: string
  expiryDate: string | null
  maxUses: number
  usesCount: number
  active: boolean
  minOrderAmount: number | null
  maxDiscountAmount: number | null
}

export interface HistoryEntry {
  id: number
  fromStatus: string
  toStatus: string
  changedBy: number | null
  reason: string | null
  at: string | null
}

// Request bodies (swagger-final.json)

export interface CreateDriverRequest {
  first_name: string
  last_name: string
  phone: string
  email: string | null
  password: string
  license_number: string
  hire_date: string
}

export interface UpdateDriverRequest {
  first_name: string | null
  last_name: string | null
  email: string | null
  license_number: string | null
}

export interface TariffRequest {
  name: string
  service_class: string
  base_fare: number
  rate_per_km: number
  rate_per_min: number
}

export interface PromocodeRequest {
  code: string
  discount_value: number
  discount_type: string
  expiry_date: string
  max_uses: number
  min_order_amount: number | null
  max_discount_amount: number | null
}
