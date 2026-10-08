import { onBeforeUnmount, ref } from 'vue'

export type GeoStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable' | 'error'

export interface GeoPosition {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

export function useGeolocation() {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext
  const position = ref<GeoPosition | null>(null)
  const status = ref<GeoStatus>(supported ? 'idle' : 'unavailable')
  let watchId: number | null = null

  async function permission(): Promise<PermissionState | 'unknown'> {
    if (!supported || !navigator.permissions) return 'unknown'
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      return result.state
    } catch {
      return 'unknown'
    }
  }

  function onSuccess(pos: GeolocationPosition) {
    const { latitude, longitude, accuracy } = pos.coords
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return
    position.value = {
      lat: latitude,
      lng: longitude,
      accuracy: Number.isFinite(accuracy) ? Math.max(0, accuracy) : 0,
      timestamp: pos.timestamp,
    }
    status.value = 'watching'
  }

  function onError(error: GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      status.value = 'denied'
      stop(false)
      return
    }
    if (!position.value) status.value = error.code === error.POSITION_UNAVAILABLE ? 'unavailable' : 'error'
  }

  function start() {
    if (!supported) {
      status.value = 'unavailable'
      return
    }
    if (watchId !== null) return
    status.value = 'requesting'
    watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    })
  }

  function stop(reset = true) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    watchId = null
    if (reset && status.value === 'watching') status.value = 'idle'
  }

  onBeforeUnmount(() => stop())

  return { supported, position, status, start, stop, permission }
}