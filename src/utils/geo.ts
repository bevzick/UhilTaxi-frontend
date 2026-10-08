const EARTH_RADIUS_M = 6_371_000

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace('.', ',')} км`
}

export function coordsLabel(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function curvePoints(a: [number, number], b: [number, number], segments = 32): [number, number][] {
  const [lat1, lng1] = a
  const [lat2, lng2] = b
  const midLat = (lat1 + lat2) / 2
  const midLng = (lng1 + lng2) / 2
  const dLat = lat2 - lat1
  const dLng = lng2 - lng1
  const ctrlLat = midLat - dLng * 0.18
  const ctrlLng = midLng + dLat * 0.18
  const points: [number, number][] = []

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const m = 1 - t
    points.push([
      m * m * lat1 + 2 * m * t * ctrlLat + t * t * lat2,
      m * m * lng1 + 2 * m * t * ctrlLng + t * t * lng2,
    ])
  }

  return points
}