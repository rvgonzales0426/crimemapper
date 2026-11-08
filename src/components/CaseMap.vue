<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Small map of a case's linked incidents. Rows with a coord_flag (missing or
// the stacked default pin) aren't plotted.
const props = defineProps({
  incidents: { type: Array, required: true },
})

const el = ref(null)
let map = null
let layer = null

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function draw() {
  if (!map) return
  if (layer) map.removeLayer(layer)
  layer = L.featureGroup()
  for (const inc of props.incidents) {
    if (inc.lat == null || inc.lng == null || inc.coordFlag) continue
    L.circleMarker([inc.lat, inc.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#e85d04',
      fillOpacity: 0.9,
    })
      .bindTooltip(`${esc(inc.blotterno)} · ${esc(inc.dateCommitted)}`)
      .addTo(layer)
  }
  layer.addTo(map)
  if (layer.getLayers().length) map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 16 })
}

onMounted(() => {
  map = L.map(el.value, { scrollWheelZoom: false }).setView([8.95, 125.54], 12)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  draw()
})

watch(() => props.incidents, draw)

onBeforeUnmount(() => {
  if (map) map.remove()
  map = null
})
</script>

<template>
  <div ref="el" class="case-map"></div>
</template>

<style scoped>
.case-map {
  height: 240px;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}
</style>
