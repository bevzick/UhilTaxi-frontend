export type PlaceSource = 'me' | 'map' | 'search'

export interface Place {
  lat: number
  lng: number
  address: string
  source?: PlaceSource
  pending?: boolean
}

export interface GeoSuggestion extends Place {
  id: string
  title: string
  subtitle: string
}