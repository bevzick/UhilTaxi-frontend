import { CITY, inCity } from '@/config/city'
import { coordsLabel } from '@/utils/geo'
import { clean } from '@/utils/validation'
import type { GeoSuggestion, Place } from '@/types/geo'

const MIN_GAP_MS = 1100
const MAX_QUERY = 120
const CACHE_LIMIT = 60

function resolveBase(raw: string | undefined) {
  try {
    const url = new URL(raw ?? '')
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && import.meta.env.DEV)) throw new Error('protocol')
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    console.error('VITE_GEOCODER_URL має бути коректною адресою https')
    return ''
  }
}

const BASE = resolveBase(import.meta.env.VITE_GEOCODER_URL)
const { south, west, north, east } = CITY.bounds
const VIEWBOX = `${west},${north},${east},${south}`

let lastCall = 0
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, unknown>()

const abortError = () => new DOMException('Aborted', 'AbortError')
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })
}

function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) throw abortError()
    const waitMs = lastCall + MIN_GAP_MS - Date.now()
    if (waitMs > 0) await sleep(waitMs, signal)
    lastCall = Date.now()
    return task()
  })
  queue = run.catch(() => undefined)
  return run
}

function remember(key: string, value: unknown) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, value)
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  if (!BASE) throw new Error('geocoder')
  const cached = cache.get(url)
  if (cached !== undefined) return cached

  const data = await schedule(async () => {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`geocoder ${response.status}`)
    return (await response.json()) as unknown
  }, signal)

  remember(url, data)
  return data
}

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' ? clean(value).replace(/\s+/g, ' ').trim().slice(0, 120) : '')

function toSuggestion(item: unknown): GeoSuggestion | null {
  if (!isRecord(item)) return null
  const lat = Number(item.lat)
  const lng = Number(item.lon)
  if (!inCity(lat, lng)) return null

  const address = isRecord(item.address) ? item.address : {}
  const road = str(address.road) || str(address.pedestrian) || str(address.square)
  const house = str(address.house_number)
  const name = str(item.name)
  const area = str(address.suburb) || str(address.neighbourhood) || str(address.quarter) || str(address.city_district)

  const street = road ? [road, house].filter(Boolean).join(', ') : ''
  const title = name && name !== road ? name : street || str(item.display_name).split(',')[0] || coordsLabel(lat, lng)
  const subtitle = name && street && name !== road ? street : area || CITY.name
  const full = [title, subtitle !== CITY.name && subtitle !== title ? subtitle : ''].filter(Boolean).join(', ')

  return {
    id: String(item.place_id ?? `${lat},${lng}`).slice(0, 40),
    lat,
    lng,
    title,
    subtitle,
    address: full,
    source: 'search',
  }
}

export async function searchAddress(query: string, signal?: AbortSignal): Promise<GeoSuggestion[]> {
  const q = clean(query).replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
  if (q.length < 3) return []

  const params = new URLSearchParams({
    format: 'jsonv2',
    q,
    viewbox: VIEWBOX,
    bounded: '1',
    countrycodes: 'ua',
    addressdetails: '1',
    limit: '7',
    'accept-language': 'uk',
  })

  const data = await getJson(`${BASE}/search?${params}`, signal)
  if (!Array.isArray(data)) return []

  const seen = new Set<string>()
  return data
    .map(toSuggestion)
    .filter((item): item is GeoSuggestion => {
      if (!item || seen.has(item.address)) return false
      seen.add(item.address)
      return true
    })
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<Place> {
  const fallback: Place = { lat, lng, address: coordsLabel(lat, lng) }
  if (!inCity(lat, lng)) return fallback

  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'uk',
  })

  try {
    const data = await getJson(`${BASE}/reverse?${params}`, signal)
    const suggestion = toSuggestion(isRecord(data) ? { ...data, lat, lon: lng } : null)
    return suggestion ? { lat, lng, address: suggestion.address } : fallback
  } catch (error) {
    if (isAbort(error)) throw error
    return fallback
  }
}