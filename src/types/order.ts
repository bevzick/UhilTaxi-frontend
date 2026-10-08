// Wire types mirror swagger.json (UhilTaxi.Api v1). View types below are what the UI works with
// after responses are narrowed by utils/order.ts.

export interface OrderLocationRequest {
  address: string
  lat: number
  lng: number
}

export interface CreateOrderRequest {
  tariff_id: number
  pickup: OrderLocationRequest
  destination: OrderLocationRequest
  promocode: string | null
}

export interface CancelOrderRequest {
  reason: string | null
}

export interface CompleteTripRequest {
  distance_km: number | null
}

export interface StartTripRequest {
  shift_id: number
}

export interface Paged<T> {
  data: T[]
  page: number
  pages: number
  total: number
}

export type OrderStage = 'searching' | 'accepted' | 'arrived' | 'started' | 'completed' | 'cancelled'

export interface Tariff {
  id: number
  name: string
  serviceClass: string
  baseFare: number
  ratePerKm: number
  ratePerMin: number
}

export interface Estimate {
  distanceKm: number
  durationMin: number
  baseAmount: number
  discountAmount: number
  fare: number
}

export interface Person {
  id: number | null
  firstName: string
  lastName: string
  phone: string | null
  rating: number | null
  ratingCount: number
  car: string | null
  plate: string | null
}

export interface OrderPoint {
  address: string
  lat: number
  lng: number
}

export interface OrderView {
  id: number
  stage: OrderStage
  status: string
  clientId: number | null
  tariffId: number | null
  driverId: number | null
  pickup: OrderPoint
  destination: OrderPoint
  distanceKm: number | null
  durationMin: number | null
  fare: number | null
  cancellationReason: string | null
  createdAt: string | null
  acceptedAt: string | null
  driver: Person | null
  client: Person | null
}

export interface TripView {
  id: number
  orderId: number | null
  distanceKm: number | null
  durationMin: number | null
  fare: number | null
  tariffName: string | null
  startedAt: string | null
  endedAt: string | null
}
