import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@/assets/map.css'
import { CITY } from '@/config/city'
import { curvePoints } from '@/utils/geo'

const TILES_URL = import.meta.env.VITE_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
  (TILES_URL.includes('cartocdn') ? ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>' : '')

export type LatLng = { lat: number; lng: number }

/** Leaflet map locked to the city, with the shared tile layer and no default controls. */
export function createCityMap(el: HTMLElement) {
  const { south, west, north, east } = CITY.bounds
  const map = L.map(el, {
    center: CITY.center,
    zoom: 13,
    minZoom: 12,
    maxZoom: 18,
    zoomControl: false,
    doubleClickZoom: false,
    zoomSnap: 0.5,
    maxBounds: L.latLngBounds([south - 0.04, west - 0.06], [north + 0.04, east + 0.06]),
    maxBoundsViscosity: 0.9,
  })

  L.tileLayer(TILES_URL, { attribution: ATTRIBUTION, subdomains: 'abcd', maxZoom: 19 }).addTo(map)
  map.attributionControl.setPrefix(false)
  return map
}

export const icons = {
  me: L.divIcon({
    className: 'ut-icon',
    html: '<div class="ut-me"><span class="ut-me__pulse"></span><span class="ut-me__dot"></span></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  }),
  pickup: L.divIcon({
    className: 'ut-icon',
    html: '<div class="ut-start"><span></span></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  }),
  destination: L.divIcon({
    className: 'ut-icon',
    html: '<div class="ut-pin"><svg viewBox="0 0 36 46"><path d="M18 1C8.6 1 1 8.4 1 17.6 1 30 18 45 18 45s17-15 17-27.4C35 8.4 27.4 1 18 1Z"/><circle cx="18" cy="17" r="6.5"/></svg><span class="ut-pin__shadow"></span></div>',
    iconSize: [36, 46],
    iconAnchor: [18, 44],
  }),
}

/** Small numbered bubble marking a waiting client's pickup point on the driver map. */
export function requestIcon(label: string, active: boolean) {
  const safe = label.replace(/[^\d₴\s,.]/g, '').slice(0, 10)
  return L.divIcon({
    className: 'ut-icon',
    html: `<div class="ut-req${active ? ' ut-req--active' : ''}"><span class="ut-req__dot"></span><span class="ut-req__label">${safe}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

/** Animated dashed curve between two points, drawn as a glow + line pair. */
export class RouteLayer {
  private glow: L.Polyline | null = null
  private line: L.Polyline | null = null

  constructor(private map: L.Map) {}

  draw(from: LatLng, to: LatLng) {
    this.clear()
    const points = curvePoints([from.lat, from.lng], [to.lat, to.lng])
    this.glow = L.polyline(points, { color: '#2f7d57', weight: 12, opacity: 0.16, lineCap: 'round', interactive: false }).addTo(this.map)
    this.line = L.polyline(points, {
      className: 'ut-route',
      color: '#2f7d57',
      weight: 4,
      dashArray: '1 11',
      lineCap: 'round',
      interactive: false,
    }).addTo(this.map)
    return points
  }

  clear() {
    this.glow?.remove()
    this.line?.remove()
    this.glow = null
    this.line = null
  }
}
