import { request } from './http'
import { MOCK_API, mockApi } from './mock.ts'
import { inCity } from '@/config/city'
import { distanceMeters } from '@/utils/geo'
import { clean } from '@/utils/validation'
import {
  CAR_CLASSES,
  CAR_TYPES,
  MAX_PASSENGERS,
  SEATS,
  type CarClass,
  type CarType,
  type OrderExtras,
  type OrderRequest,
  type OrderResponse,
} from '@/types/order'
import type { Place } from '@/types/geo'

const ORDERS_URL = import.meta.env.VITE_ORDERS_URL
const ADDRESS_MAX = 200
export const COMMENT_MAX = 200
const MIN_TRIP_METERS = 50

export interface OrderDraft {
  pickup: Place | null
  destination: Place | null
  passengers: number
  carClass: CarClass
  carType: CarType
  extras: OrderExtras
  comment: string
}

const cleanText = (value: string, max: number) => clean(value).replace(/\s+/g, ' ').trim().slice(0, max)
const round = (value: number) => Math.round(value * 1e6) / 1e6

function validPlace(place: Place | null): place is Place {
  return !!place && !place.pending && inCity(place.lat, place.lng) && cleanText(place.address, ADDRESS_MAX).length > 0
}

export function prepareOrder(draft: OrderDraft): { data: OrderRequest } | { error: string } {
  if (!validPlace(draft.pickup)) return { error: 'Вкажіть, звідки вас забрати' }
  if (!validPlace(draft.destination)) return { error: 'Вкажіть, куди їдемо' }
  if (distanceMeters(draft.pickup, draft.destination) < MIN_TRIP_METERS) return { error: 'Точки маршруту надто близько' }
  if (!CAR_CLASSES.includes(draft.carClass)) return { error: 'Оберіть клас авто' }
  if (!CAR_TYPES.includes(draft.carType)) return { error: 'Оберіть тип авто' }
  if (!Number.isInteger(draft.passengers) || draft.passengers < 1 || draft.passengers > MAX_PASSENGERS) {
    return { error: 'Некоректна кількість пасажирів' }
  }
  if (draft.passengers > SEATS[draft.carType]) return { error: 'У цьому авто недостатньо місць' }

  const comment = cleanText(draft.comment, COMMENT_MAX)

  return {
    data: {
      pickup_address: cleanText(draft.pickup.address, ADDRESS_MAX),
      pickup_lat: round(draft.pickup.lat),
      pickup_lng: round(draft.pickup.lng),
      destination_address: cleanText(draft.destination.address, ADDRESS_MAX),
      destination_lat: round(draft.destination.lat),
      destination_lng: round(draft.destination.lng),
      passengers: draft.passengers,
      car_class: draft.carClass,
      car_type: draft.carType,
      child_seat: draft.extras.child_seat === true,
      pets: draft.extras.pets === true,
      luggage: draft.extras.luggage === true,
      comment: comment || null,
    },
  }
}

export const ordersApi = {
  create: (data: OrderRequest, token: string | null) =>
    MOCK_API
      ? mockApi.createOrder(data)
      : request<OrderResponse>(ORDERS_URL, { method: 'POST', body: data, token }),
}