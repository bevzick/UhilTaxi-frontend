<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import { RouteLayer, createCityMap, icons, type LatLng } from '@/utils/map'

const props = defineProps<{ from: LatLng | null; to: LatLng | null }>()

const el = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let route: RouteLayer | null = null
const markers: L.Marker[] = []

function draw() {
  if (!map || !route) return
  route.clear()
  markers.splice(0).forEach((marker) => marker.remove())
  const points: L.LatLngExpression[] = []
  if (props.from) {
    markers.push(L.marker([props.from.lat, props.from.lng], { icon: icons.pickup, interactive: false }).addTo(map))
    points.push([props.from.lat, props.from.lng])
  }
  if (props.to) {
    markers.push(L.marker([props.to.lat, props.to.lng], { icon: icons.destination, interactive: false }).addTo(map))
    points.push([props.to.lat, props.to.lng])
  }
  if (props.from && props.to) route.draw(props.from, props.to)
  if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 })
  else if (points.length === 1) map.setView(points[0]!, 15)
}

watch(() => [props.from?.lat, props.from?.lng, props.to?.lat, props.to?.lng], draw)

onMounted(() => {
  if (!el.value) return
  map = createCityMap(el.value)
  route = new RouteLayer(map)
  // The drawer animates in; recompute size once it has settled.
  window.setTimeout(() => {
    map?.invalidateSize()
    draw()
  }, 320)
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="el" class="mini-map" role="img" aria-label="Маршрут на карті"></div>
</template>

<style scoped>
.mini-map {
  height: 220px;
  border: 1px solid var(--line);
  border-radius: 18px;
  overflow: hidden;
  background: #eef0e8;
}
</style>
