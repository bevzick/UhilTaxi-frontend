export const CAR_CLASSES = ['economy', 'comfort', 'business'] as const
export type CarClass = (typeof CAR_CLASSES)[number]

export const CAR_TYPES = ['sedan', 'wagon', 'minivan', 'electric'] as const
export type CarType = (typeof CAR_TYPES)[number]

export const SEATS: Record<CarType, number> = {
  sedan: 4,
  wagon: 4,
  minivan: 7,
  electric: 4,
}

export const MAX_PASSENGERS = 7

export interface OrderExtras {
  child_seat: boolean
  pets: boolean
  luggage: boolean
}

export interface OrderRequest extends OrderExtras {
  pickup_address: string
  pickup_lat: number
  pickup_lng: number
  destination_address: string
  destination_lat: number
  destination_lng: number
  passengers: number
  car_class: CarClass
  car_type: CarType
  comment: string | null
}

export interface OrderResponse {
  id?: number | string
  status?: string | null
  [key: string]: unknown
}