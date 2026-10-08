export const CITY = {
  name: 'Хмельницький',
  center: [49.4229, 26.9871] as [number, number],
  bounds: {
    south: 49.36,
    west: 26.86,
    north: 49.48,
    east: 27.1,
  },
} as const

export function inCity(lat: number, lng: number) {
  const { south, west, north, east } = CITY.bounds
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= south && lat <= north && lng >= west && lng <= east
}