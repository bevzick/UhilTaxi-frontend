<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import OrderSheet from '@/components/OrderSheet.vue'
import { isAbort, reverseGeocode } from '@/api/geocode'
import { CITY, inCity } from '@/config/city'
import { useAuth } from '@/composables/useAuth'
import { useGeolocation } from '@/composables/useGeolocation'
import { coordsLabel, curvePoints, distanceMeters } from '@/utils/geo'
import type { Place } from '@/types/geo'

const TILES_URL =
  import.meta.env.VITE_MAP_TILES_URL || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
const REGEOCODE_METERS = 60
const ASK_KEY = 'uhiltaxi.geo-asked'

const router = useRouter()
const { user, logout } = useAuth()
const geo = useGeolocation()

const mapEl = ref<HTMLElement | null>(null)
const pickup = ref<Place | null>(null)
const destination = ref<Place | null>(null)
const myPlace = ref<Place | null>(null)
const sheetOpen = ref(false)
const following = ref(true)
const showHint = ref(true)
const askLocation = ref(false)
const toast = ref('')
const ready = ref(false)

const firstName = computed(() => {
  const name = user.value?.first_name
  return typeof name === 'string' ? name.slice(0, 40) : ''
})

const locateState = computed(() => {
  if (geo.status.value === 'watching') return following.value ? 'following' : 'on'
  if (geo.status.value === 'requesting') return 'loading'
  if (geo.status.value === 'denied' || geo.status.value === 'unavailable') return 'off'
  return 'idle'
})

let map: L.Map | null = null
let meMarker: L.Marker | null = null
let accuracyCircle: L.Circle | null = null
let pickupMarker: L.Marker | null = null
let destMarker: L.Marker | null = null
let routeGlow: L.Polyline | null = null
let routeLine: L.Polyline | null = null
let lastRouteKey = ''
let lastGeocoded: { lat: number; lng: number } | null = null
let meController: AbortController | null = null
let destController: AbortController | null = null
let toastTimer = 0
let askTimer = 0
let centeredOnMe = false

const meIcon = L.divIcon({
  className: 'ut-icon',
  html: '<div class="ut-me"><span class="ut-me__pulse"></span><span class="ut-me__dot"></span></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

const pickupIcon = L.divIcon({
  className: 'ut-icon',
  html: '<div class="ut-start"><span></span></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

const destIcon = L.divIcon({
  className: 'ut-icon',
  html: '<div class="ut-pin"><svg viewBox="0 0 36 46"><path d="M18 1C8.6 1 1 8.4 1 17.6 1 30 18 45 18 45s17-15 17-27.4C35 8.4 27.4 1 18 1Z"/><circle cx="18" cy="17" r="6.5"/></svg><span class="ut-pin__shadow"></span></div>',
  iconSize: [36, 46],
  iconAnchor: [18, 44],
})

function flash(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200)
}

const isDesktop = () => window.matchMedia('(min-width: 721px)').matches

function fitRoute(points: L.LatLngExpression[]) {
  if (!map) return
  const bounds = L.latLngBounds(points)
  const desktop = isDesktop()
  map.flyToBounds(bounds, {
    paddingTopLeft: desktop ? [80, 120] : [40, 100],
    paddingBottomRight: desktop ? [480, 80] : [40, Math.round(window.innerHeight * 0.6)],
    maxZoom: 16,
    duration: 0.9,
  })
}

function drawRoute() {
  if (!map) return
  routeGlow?.remove()
  routeLine?.remove()
  routeGlow = null
  routeLine = null

  const from = pickup.value
  const to = destination.value
  if (!from || !to) {
    lastRouteKey = ''
    return
  }

  const points = curvePoints([from.lat, from.lng], [to.lat, to.lng])
  routeGlow = L.polyline(points, { color: '#2f7d57', weight: 12, opacity: 0.16, lineCap: 'round', interactive: false }).addTo(map)
  routeLine = L.polyline(points, {
    className: 'ut-route',
    color: '#2f7d57',
    weight: 4,
    dashArray: '1 11',
    lineCap: 'round',
    interactive: false,
  }).addTo(map)

  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`
  if (key !== lastRouteKey) {
    lastRouteKey = key
    following.value = false
    fitRoute(points)
  }
}

async function resolveDestination(lat: number, lng: number) {
  destController?.abort()
  destController = new AbortController()
  destination.value = { lat, lng, address: '', source: 'map', pending: true }

  try {
    const place = await reverseGeocode(lat, lng, destController.signal)
    if (destination.value?.lat === lat && destination.value.lng === lng) {
      destination.value = { ...place, source: 'map' }
    }
  } catch (error) {
    if (isAbort(error)) return
    destination.value = { lat, lng, address: coordsLabel(lat, lng), source: 'map' }
  }
}

function pickDestination(latlng: L.LatLng) {
  const { lat, lng } = latlng
  if (!inCity(lat, lng)) {
    flash('Ми працюємо лише в межах Хмельницького')
    return
  }
  showHint.value = false
  sheetOpen.value = true
  resolveDestination(lat, lng)
}

function openFromMe() {
  showHint.value = false
  if (myPlace.value) pickup.value = { ...myPlace.value }
  sheetOpen.value = true
}

function openSheet() {
  showHint.value = false
  sheetOpen.value = true
}

function onOrderDone() {
  sheetOpen.value = false
  destination.value = null
  if (myPlace.value) pickup.value = { ...myPlace.value }
}

async function updateMyPlace(lat: number, lng: number) {
  if (!inCity(lat, lng)) {
    myPlace.value = null
    return
  }
  if (lastGeocoded && distanceMeters(lastGeocoded, { lat, lng }) < REGEOCODE_METERS) return

  lastGeocoded = { lat, lng }
  const draft: Place = { lat, lng, address: '', source: 'me', pending: true }
  myPlace.value = draft
  if (!pickup.value || pickup.value.source === 'me') pickup.value = draft

  meController?.abort()
  meController = new AbortController()

  try {
    const place = await reverseGeocode(lat, lng, meController.signal)
    const resolved: Place = { ...place, source: 'me' }
    myPlace.value = resolved
    if (!pickup.value || pickup.value.source === 'me') pickup.value = resolved
  } catch (error) {
    if (isAbort(error)) return
    const fallback: Place = { lat, lng, address: 'Моє місцезнаходження', source: 'me' }
    myPlace.value = fallback
    if (!pickup.value || pickup.value.source === 'me') pickup.value = fallback
  }
}

function onLocate() {
  if (!map) return
  if (geo.status.value === 'watching' && geo.position.value) {
    const { lat, lng } = geo.position.value
    if (!inCity(lat, lng)) {
      flash('Схоже, ви зараз поза Хмельницьким')
      return
    }
    following.value = true
    map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
    return
  }
  if (geo.status.value === 'denied') {
    flash('Доступ до геолокації заборонено. Увімкніть його в налаштуваннях браузера')
    return
  }
  if (geo.status.value === 'unavailable') {
    flash('Геолокація недоступна на цьому пристрої')
    return
  }
  allowLocation()
}

function allowLocation() {
  askLocation.value = false
  rememberAsked()
  geo.start()
}

function dismissAsk() {
  askLocation.value = false
  rememberAsked()
}

function rememberAsked() {
  try {
    sessionStorage.setItem(ASK_KEY, '1')
  } catch {
    return
  }
}

function wasAsked() {
  try {
    return sessionStorage.getItem(ASK_KEY) === '1'
  } catch {
    return false
  }
}

function zoom(delta: number) {
  map?.setZoom(map.getZoom() + delta)
}

function onLogout() {
  logout()
  router.replace('/')
}

watch(geo.position, (position) => {
  if (!position || !map) return
  const { lat, lng, accuracy } = position
  const latlng = L.latLng(lat, lng)

  if (!meMarker) {
    meMarker = L.marker(latlng, { icon: meIcon, zIndexOffset: 1000, title: 'Ви тут', riseOnHover: true })
      .addTo(map)
      .on('click', openFromMe)
    accuracyCircle = L.circle(latlng, {
      radius: Math.min(accuracy, 500),
      stroke: false,
      fillColor: '#2f7d57',
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(map)
  } else {
    meMarker.setLatLng(latlng)
    accuracyCircle?.setLatLng(latlng).setRadius(Math.min(accuracy, 500))
  }

  if (!inCity(lat, lng)) {
    if (!centeredOnMe) flash('Схоже, ви зараз поза Хмельницьким')
    centeredOnMe = true
  } else if (!centeredOnMe) {
    centeredOnMe = true
    map.flyTo(latlng, 16, { duration: 1.2 })
  } else if (following.value && !sheetOpen.value) {
    map.panTo(latlng, { animate: true })
  }

  updateMyPlace(lat, lng)
})

watch(
  () => geo.status.value,
  (status) => {
    if (status === 'denied') flash('Без геолокації — просто вкажіть адресу посадки вручну')
  },
)

watch(pickup, (place) => {
  if (!map) return
  if (!place || place.source === 'me') {
    pickupMarker?.remove()
    pickupMarker = null
  } else if (!pickupMarker) {
    pickupMarker = L.marker([place.lat, place.lng], { icon: pickupIcon, zIndexOffset: 500 }).addTo(map)
  } else {
    pickupMarker.setLatLng([place.lat, place.lng])
  }
  drawRoute()
})

watch(destination, (place) => {
  if (!map) return
  if (!place) {
    destMarker?.remove()
    destMarker = null
  } else if (!destMarker) {
    destMarker = L.marker([place.lat, place.lng], {
      icon: destIcon,
      draggable: true,
      autoPan: true,
      zIndexOffset: 800,
      title: 'Куди',
    })
      .addTo(map)
      .on('dragend', () => {
        const point = destMarker?.getLatLng()
        if (!point) return
        if (!inCity(point.lat, point.lng)) {
          flash('Ми працюємо лише в межах Хмельницького')
          if (destination.value) destMarker?.setLatLng([destination.value.lat, destination.value.lng])
          return
        }
        resolveDestination(point.lat, point.lng)
      })
  } else {
    destMarker.setLatLng([place.lat, place.lng])
  }
  drawRoute()
})

onMounted(async () => {
  if (!mapEl.value) return
  const { south, west, north, east } = CITY.bounds

  map = L.map(mapEl.value, {
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

  L.tileLayer(TILES_URL, {
    attribution: ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 19,
    detectRetina: true,
  }).addTo(map)

  map.attributionControl.setPrefix(false)
  map.on('dblclick', (event: L.LeafletMouseEvent) => pickDestination(event.latlng))
  map.on('contextmenu', (event: L.LeafletMouseEvent) => pickDestination(event.latlng))
  map.on('dragstart', () => (following.value = false))
  map.whenReady(() => (ready.value = true))

  const permission = await geo.permission()
  if (permission === 'granted') geo.start()
  else if (permission !== 'denied' && geo.supported && !wasAsked()) {
    askTimer = window.setTimeout(() => (askLocation.value = true), 900)
  }
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  clearTimeout(askTimer)
  meController?.abort()
  destController?.abort()
  map?.remove()
  map = null
})
</script>

<template>
  <div class="page" :class="{ 'page--ready': ready }">
    <div ref="mapEl" class="map" role="application" aria-label="Карта Хмельницького"></div>

    <header class="topbar">
      <RouterLink to="/" class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
      </RouterLink>

      <div class="topbar__right">
        <span v-if="firstName" class="topbar__hello">Привіт, {{ firstName }}</span>
        <button type="button" class="topbar__logout" @click="onLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </svg>
          <span>Вийти</span>
        </button>
      </div>
    </header>

    <Transition name="pop">
      <div v-if="askLocation" class="card ask" role="dialog" aria-label="Доступ до геолокації">
        <span class="ask__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
        </span>
        <div class="ask__body">
          <p class="ask__title">Показати, де ви?</p>
          <p class="ask__text">Так водій швидше знайде вас, а адреса посадки заповниться сама.</p>
          <div class="ask__actions">
            <button type="button" class="btn btn--primary" @click="allowLocation">Дозволити</button>
            <button type="button" class="btn btn--ghost" @click="dismissAsk">Не зараз</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="pop">
      <div v-if="showHint && !sheetOpen && !askLocation" class="card hint">
        <span class="hint__icon" aria-hidden="true">
          <span></span>
        </span>
        <p class="hint__text">
          <strong>Двічі клацніть</strong> на карті, щоб обрати, куди їхати, або натисніть на свою позначку
        </p>
        <button type="button" class="hint__close" aria-label="Сховати підказку" @click="showHint = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </Transition>

    <div class="controls" :class="{ 'controls--shifted': sheetOpen }">
      <div class="controls__group">
        <button type="button" class="ctrl" aria-label="Наблизити" @click="zoom(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <span class="controls__sep"></span>
        <button type="button" class="ctrl" aria-label="Віддалити" @click="zoom(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="ctrl ctrl--locate"
        :class="`ctrl--${locateState}`"
        :aria-label="locateState === 'off' ? 'Геолокація недоступна' : 'Моє місцезнаходження'"
        @click="onLocate"
      >
        <span v-if="locateState === 'loading'" class="ctrl__spinner"></span>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.5" :fill="locateState === 'following' ? 'currentColor' : 'none'" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <path v-if="locateState === 'off'" d="M4 4l16 16" />
        </svg>
      </button>
    </div>

    <Transition name="cta">
      <button v-if="!sheetOpen" type="button" class="cta" @click="openSheet">
        <span class="cta__dot"></span>
        <span class="cta__text">Куди їдемо?</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </Transition>

    <OrderSheet
      v-model:pickup="pickup"
      v-model:destination="destination"
      :open="sheetOpen"
      :my-place="myPlace"
      @close="sheetOpen = false"
      @done="onOrderDone"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #eef0e8;
}

.map {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  transform: scale(1.04);
  transition:
    opacity 0.8s ease,
    transform 1.2s var(--ease-out);
}

.page--ready .map {
  opacity: 1;
  transform: scale(1);
}

.card {
  border: 1px solid rgba(236, 229, 214, 0.9);
  border-radius: 20px;
  background: rgba(255, 253, 248, 0.94);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 44px rgba(40, 35, 20, 0.16);
}

.topbar {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  z-index: 900;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 14px;
  border: 1px solid rgba(236, 229, 214, 0.9);
  border-radius: 20px;
  background: rgba(255, 253, 248, 0.9);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 32px rgba(40, 35, 20, 0.12);
  animation: drop 0.7s 0.2s var(--ease-out) backwards;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.logo__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #2f7d57;
  color: #fbf7ee;
  font-size: 19px;
  font-weight: 700;
}

.logo__name {
  font-size: 20px;
  font-weight: 700;
  color: #2b2b26;
}

.logo__name span {
  color: #2f7d57;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.topbar__hello {
  font-size: 15px;
  font-weight: 600;
  color: #4a473f;
}

.topbar__logout {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  border-radius: 13px;
  background: #f1ebdd;
  color: #4a473f;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.topbar__logout:hover {
  background: #fbeae6;
  color: #9f3a28;
}

.topbar__logout svg {
  width: 18px;
  height: 18px;
}

.ask {
  position: absolute;
  top: 96px;
  left: 16px;
  z-index: 900;
  display: flex;
  gap: 14px;
  width: min(380px, calc(100% - 32px));
  padding: 18px;
}

.ask__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #e3efe7;
  color: #2f7d57;
  animation: bob 2s ease-in-out infinite;
}

.ask__icon svg {
  width: 22px;
  height: 22px;
}

.ask__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: #2b2b26;
}

.ask__text {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.5;
  color: #6b675c;
}

.ask__actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 10px 16px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.2s var(--ease-out),
    background-color 0.2s ease;
}

.btn:active {
  transform: scale(0.97);
}

.btn--primary {
  border: none;
  background: #2f7d57;
  color: #fbf7ee;
}

.btn--primary:hover {
  background: #266a49;
}

.btn--ghost {
  border: 1.5px solid #e6dfcf;
  background: transparent;
  color: #4a473f;
}

.hint {
  position: absolute;
  top: 96px;
  left: 50%;
  z-index: 900;
  display: flex;
  align-items: center;
  gap: 12px;
  width: max-content;
  max-width: min(520px, calc(100% - 32px));
  padding: 12px 12px 12px 14px;
  transform: translateX(-50%);
}

.hint__icon {
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #e3efe7;
}

.hint__icon span {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: #2f7d57;
  animation: tap 1.6s ease-in-out infinite;
}

.hint__icon::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px solid #2f7d57;
  border-radius: 50%;
  opacity: 0;
  animation: tap-ring 1.6s ease-out infinite;
}

.hint__text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: #4a473f;
}

.hint__text strong {
  color: #2b2b26;
}

.hint__close {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #f1ebdd;
  color: #8a8578;
  cursor: pointer;
}

.hint__close svg {
  width: 12px;
  height: 12px;
}

.controls {
  position: absolute;
  right: 20px;
  bottom: 32px;
  z-index: 900;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.5s var(--ease-out);
  animation: rise 0.7s 0.45s var(--ease-out) backwards;
}

.controls--shifted {
  transform: translateX(-440px);
}

.controls__group {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(236, 229, 214, 0.9);
  border-radius: 16px;
  background: rgba(255, 253, 248, 0.94);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.14);
  overflow: hidden;
}

.controls__sep {
  height: 1px;
  margin: 0 10px;
  background: #ece5d6;
}

.ctrl {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: none;
  background: transparent;
  color: #2b2b26;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.ctrl:hover {
  background: #f1ebdd;
}

.ctrl:active {
  transform: scale(0.92);
}

.ctrl svg {
  width: 22px;
  height: 22px;
}

.ctrl--locate {
  border: 1px solid rgba(236, 229, 214, 0.9);
  border-radius: 16px;
  background: rgba(255, 253, 248, 0.94);
  box-shadow: 0 12px 30px rgba(40, 35, 20, 0.14);
}

.ctrl--on,
.ctrl--following {
  color: #2f7d57;
}

.ctrl--following {
  background: #e3efe7;
}

.ctrl--off {
  color: #b5ae9f;
}

.ctrl__spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid #e3efe7;
  border-top-color: #2f7d57;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.cta {
  position: absolute;
  left: 50%;
  bottom: 32px;
  z-index: 900;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 18px 26px 18px 22px;
  border: none;
  border-radius: 20px;
  background: #2f7d57;
  color: #fbf7ee;
  font-family: inherit;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  transform: translateX(-50%);
  box-shadow: 0 18px 40px rgba(47, 125, 87, 0.38);
  transition:
    background-color 0.2s ease,
    box-shadow 0.25s ease;
}

.cta:hover {
  background: #266a49;
  box-shadow: 0 22px 48px rgba(47, 125, 87, 0.45);
}

.cta svg {
  width: 20px;
  height: 20px;
  transition: transform 0.2s ease;
}

.cta:hover svg {
  transform: translateX(4px);
}

.cta__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8fd1ab;
  box-shadow: 0 0 0 4px rgba(143, 209, 171, 0.25);
  animation: glow 2s ease-in-out infinite;
}

.toast {
  position: absolute;
  top: 96px;
  left: 50%;
  z-index: 1100;
  max-width: min(440px, calc(100% - 32px));
  padding: 12px 18px;
  border-radius: 14px;
  background: #2b2b26;
  color: #fbf7ee;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  transform: translateX(-50%);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.25);
}

.pop-enter-active {
  transition:
    opacity 0.35s ease,
    transform 0.5s var(--ease-out);
}

.pop-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  translate: 0 -12px;
  scale: 0.97;
}

.cta-enter-active {
  transition:
    opacity 0.35s ease,
    translate 0.5s var(--ease-out);
}

.cta-leave-active {
  transition:
    opacity 0.2s ease,
    translate 0.25s ease;
}

.cta-enter-from,
.cta-leave-to {
  opacity: 0;
  translate: 0 24px;
}

.toast-enter-active {
  transition:
    opacity 0.25s ease,
    translate 0.4s var(--ease-out);
}

.toast-leave-active {
  transition: opacity 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  translate: 0 -10px;
}

.toast-leave-to {
  opacity: 0;
}

@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}

@keyframes tap {
  0%,
  100% {
    transform: scale(1);
  }
  15%,
  45% {
    transform: scale(0.7);
  }
  30% {
    transform: scale(1);
  }
}

@keyframes tap-ring {
  0%,
  10% {
    opacity: 0;
    transform: scale(0.6);
  }
  20% {
    opacity: 0.8;
  }
  60%,
  100% {
    opacity: 0;
    transform: scale(1.4);
  }
}

@keyframes glow {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(143, 209, 171, 0.25);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(143, 209, 171, 0.08);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .topbar {
    top: calc(10px + env(safe-area-inset-top));
    left: 10px;
    right: 10px;
    padding: 8px 8px 8px 12px;
    border-radius: 18px;
  }

  .logo__icon {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }

  .logo__name {
    font-size: 18px;
  }

  .topbar__hello {
    display: none;
  }

  .topbar__logout {
    padding: 9px;
  }

  .topbar__logout span {
    display: none;
  }

  .ask,
  .hint,
  .toast {
    top: calc(80px + env(safe-area-inset-top));
  }

  .ask {
    left: 10px;
    width: calc(100% - 20px);
  }

  .hint {
    max-width: calc(100% - 20px);
  }

  .controls {
    right: 12px;
    bottom: calc(100px + env(safe-area-inset-bottom));
  }

  .controls--shifted {
    transform: none;
    opacity: 0;
    pointer-events: none;
  }

  .ctrl {
    width: 46px;
    height: 46px;
  }

  .cta {
    left: 12px;
    right: 12px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    justify-content: center;
    transform: none;
  }
}

@media (hover: none) {
  .ctrl:hover {
    background: transparent;
  }

  .ctrl--following:hover {
    background: #e3efe7;
  }

  .cta:hover {
    background: #2f7d57;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map,
  .topbar,
  .controls {
    animation: none;
    transition: none;
    opacity: 1;
    transform: none;
  }
}
</style>

<style>
.ut-icon {
  background: transparent;
  border: none;
}

.ut-me {
  position: relative;
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.ut-me__dot {
  position: absolute;
  inset: 6px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  background: #2f7d57;
  box-shadow: 0 4px 12px rgba(47, 125, 87, 0.5);
  transition: transform 0.2s ease;
}

.ut-me:hover .ut-me__dot {
  transform: scale(1.15);
}

.ut-me__pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(47, 125, 87, 0.35);
  animation: ut-pulse 2s ease-out infinite;
}

.ut-start {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(40, 35, 20, 0.25);
  animation: ut-pop 0.45s cubic-bezier(0.34, 1.6, 0.5, 1) backwards;
}

.ut-start span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #2f7d57;
}

.ut-pin {
  position: relative;
  width: 36px;
  height: 46px;
  cursor: grab;
  animation: ut-drop 0.6s cubic-bezier(0.34, 1.4, 0.5, 1) backwards;
}

.ut-pin svg {
  position: relative;
  z-index: 1;
  width: 36px;
  height: 46px;
  filter: drop-shadow(0 6px 10px rgba(40, 35, 20, 0.3));
}

.ut-pin path {
  fill: #2b2b26;
}

.ut-pin circle {
  fill: #fbf7ee;
}

.ut-pin__shadow {
  position: absolute;
  left: 50%;
  bottom: -3px;
  width: 16px;
  height: 6px;
  border-radius: 50%;
  background: rgba(40, 35, 20, 0.25);
  transform: translateX(-50%);
  animation: ut-shadow 0.6s ease backwards;
}

.leaflet-dragging .ut-pin {
  cursor: grabbing;
}

.ut-route {
  animation: ut-dash 0.9s linear infinite;
}

.leaflet-container {
  background: #eef0e8;
  font-family: inherit;
}

.leaflet-tile-pane {
  filter: saturate(0.85) sepia(0.08);
}

.leaflet-control-attribution {
  margin: 0 8px 8px 0 !important;
  padding: 2px 8px !important;
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.8) !important;
  font-size: 10.5px;
  color: #8a8578;
}

.leaflet-control-attribution a {
  color: #2f7d57;
}

@keyframes ut-pulse {
  from {
    opacity: 1;
    transform: scale(0.6);
  }
  to {
    opacity: 0;
    transform: scale(2.2);
  }
}

@keyframes ut-pop {
  from {
    opacity: 0;
    transform: scale(0.3);
  }
}

@keyframes ut-drop {
  0% {
    opacity: 0;
    transform: translateY(-40px);
  }
  60% {
    opacity: 1;
    transform: translateY(3px);
  }
  100% {
    transform: translateY(0);
  }
}

@keyframes ut-shadow {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.3);
  }
}

@keyframes ut-dash {
  to {
    stroke-dashoffset: -12;
  }
}

@media (max-width: 720px) {
  .leaflet-control-attribution {
    margin-bottom: calc(84px + env(safe-area-inset-bottom)) !important;
  }
}
</style>