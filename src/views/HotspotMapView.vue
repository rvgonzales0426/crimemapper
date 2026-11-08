<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { storeToRefs } from 'pinia'
import { useIncidentsStore } from '../stores/incidents'
import { useKnoxStore } from '../stores/knox'
import KnoxPanel from '../components/KnoxPanel.vue'
import { usePatrolStore, patrolWindow } from '../stores/patrol'
import PatrolPanel from '../components/PatrolPanel.vue'

// Map center: Barangay Ampayon, Butuan City, Philippines
const AMPAYON = { lat: 8.9475, lng: 125.5406, zoom: 14 }

const store = useIncidentsStore()
const { mapIncidents, mapLoading, mapError, kdeCells, kdeLoading, filters } =
  storeToRefs(store)
const knoxStore = useKnoxStore()
const { result: knoxResult, points: knoxPoints } = storeToRefs(knoxStore)
const patrolStore = usePatrolStore()
const { zones: patrolZones } = storeToRefs(patrolStore)
const activeZid = ref(null)

const hasActiveFilters = computed(() => Object.values(filters.value).some(Boolean))

const toggles = [
  { key: 'points', label: 'Incident Points' },
  { key: 'heatmap', label: 'KDE Heatmap' },
  { key: 'knox', label: 'Knox Clusters' },
  { key: 'patrol', label: 'Patrol Zones' },
]

const visible = reactive({
  points: true,
  heatmap: false,
  knox: false,
  patrol: false,
})

const mapEl = ref(null)
const controlEl = ref(null)
const panelsEl = ref(null)
let map = null
let resizeObserver = null
const layers = {}

// Popups are raw HTML; field values come from imported spreadsheets.
function esc(v) {
  return String(v ?? '—').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function buildIncidentLayer(list) {
  const group = L.layerGroup()
  for (const inc of list) {
    if (inc.lat == null || inc.lng == null) continue
    const marker = L.circleMarker([inc.lat, inc.lng], {
      radius: 8,
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#e85d04',
      fillOpacity: 0.9,
    })
    marker.bindPopup(
      `<div class="incident-popup">
        <strong>${esc(inc.offense)}</strong>
        <span>Blotter: ${esc(inc.blotterno)}</span>
        <span>Barangay ${esc(inc.barangay)}</span>
        <span>Committed: ${esc(inc.dateCommitted)}</span>
      </div>`
    )
    group.addLayer(marker)
  }
  return group
}

// KDE colour ramp, low -> high density. Mirrored by the legend gradient.
const KDE_RAMP = [
  [0, [253, 224, 71]],
  [0.5, [249, 115, 22]],
  [1, [220, 38, 38]],
]
function kdeColor(w) {
  for (let i = 1; i < KDE_RAMP.length; i++) {
    const [t1, c1] = KDE_RAMP[i]
    if (w <= t1) {
      const [t0, c0] = KDE_RAMP[i - 1]
      const f = (w - t0) / (t1 - t0)
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(',')})`
    }
  }
  return `rgb(${KDE_RAMP[KDE_RAMP.length - 1][1].join(',')})`
}

// KDE heatmap: one rectangle per density grid cell from PostGIS. Thousands of
// cells, so draw on a shared canvas rather than as SVG elements.
const kdeRenderer = L.canvas({ padding: 0.5 })
function buildHeatmapLayer(cells) {
  const group = L.layerGroup()
  for (const c of cells) {
    group.addLayer(
      L.rectangle(
        [
          [c.south, c.west],
          [c.north, c.east],
        ],
        {
          renderer: kdeRenderer,
          stroke: false,
          interactive: false,
          fillColor: kdeColor(c.weight),
          fillOpacity: 0.15 + 0.5 * c.weight,
        }
      )
    )
  }
  return group
}

// Knox near-repeat clusters: incidents chained by links within the panel's
// distance + time limits. Each cluster gets a dashed outline (popup lists its
// incidents), the links themselves, and a dot per incident.
const KNOX_COLOR = '#a78bfa'
function buildKnoxLayer(res, pts) {
  const group = L.layerGroup()
  if (!res || !pts.length) return group

  for (const [i, j] of res.links) {
    group.addLayer(
      L.polyline(
        [
          [pts[i].lat, pts[i].lng],
          [pts[j].lat, pts[j].lng],
        ],
        { color: KNOX_COLOR, weight: 2, opacity: 0.8, interactive: false }
      )
    )
  }

  for (const c of res.clusters) {
    const members = c.members.map((i) => pts[i])
    const lat = members.reduce((s, p) => s + p.lat, 0) / members.length
    const lng = members.reduce((s, p) => s + p.lng, 0) / members.length
    const dates = members.map((p) => p.dateCommitted).sort()
    const rows = [...members]
      .sort((a, b) => a.dateCommitted.localeCompare(b.dateCommitted))
      .map(
        (p) =>
          `<li><b>${esc(p.dateCommitted)}</b> · ${esc(p.barangay)}<br>${esc(p.offenses)}</li>`
      )
      .join('')

    group.addLayer(
      L.circle([lat, lng], {
        radius: Math.max(60, c.radius + 40),
        color: KNOX_COLOR,
        weight: 2,
        dashArray: '6 6',
        fillColor: KNOX_COLOR,
        fillOpacity: 0.1,
      }).bindPopup(
        `<div class="incident-popup knox-popup">
          <strong>Near-repeat cluster · ${members.length} incidents</strong>
          <span>${esc(dates[0])} to ${esc(dates[dates.length - 1])}</span>
          <ul>${rows}</ul>
        </div>`,
        { maxWidth: 320 }
      )
    )

    for (const p of members) {
      group.addLayer(
        L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color: '#ffffff',
          weight: 1.5,
          fillColor: KNOX_COLOR,
          fillOpacity: 1,
          interactive: false,
        })
      )
    }
  }
  return group
}

// Priority patrol zones: KDE hotspots merged into polygons (PostGIS), ranked by
// incident count. Each carries a permanent rank label and a details popup.
const PATROL_COLOR = '#2dd4bf'
const zoneLayers = new Map() // zid -> L.GeoJSON, for click-to-focus
const zoneStyle = (zid) => ({
  color: PATROL_COLOR,
  weight: activeZid.value === zid ? 3 : 2,
  fillColor: PATROL_COLOR,
  fillOpacity: activeZid.value === zid ? 0.22 : 0.1,
})
// Restyle in place on selection change (rebuilding would close the popup).
function styleZones() {
  for (const [zid, layer] of zoneLayers) layer.setStyle(zoneStyle(zid))
}
function buildPatrolLayer(zones) {
  const group = L.layerGroup()
  zoneLayers.clear()
  for (const z of zones) {
    const w = z.window ?? patrolWindow([], [])
    const layer = L.geoJSON(z.geojson, {
      pane: 'patrol',
      style: { ...zoneStyle(z.zid), className: 'patrol-zone' },
    })
    layer.bindTooltip(String(z.rank), {
      permanent: true,
      interactive: true, // clicking the rank badge opens the zone popup
      direction: 'center',
      className: 'zone-label',
    })
    layer.bindPopup(
      `<div class="incident-popup patrol-popup">
        <strong>Patrol zone ${z.rank}</strong>
        <span>${esc(z.barangays.map((b) => b.label.toUpperCase()).join(', '))}</span>
        <span>${z.incidents} incidents (${(z.share * 100).toFixed(0)}% of total) · ${z.areaKm2.toFixed(2)} km²</span>
        <span><b>Patrol:</b> ${esc(w.days.join(', '))} · ${esc(w.time ?? 'no recorded times')}</span>
        <span>${esc(z.topOffenses.map((o) => `${o.label.split(' - ')[0].trim()} (${o.count})`).join('; '))}</span>
      </div>`,
      { maxWidth: 320 }
    )
    layer.on('click', () => (activeZid.value = z.zid))
    zoneLayers.set(z.zid, layer)
    group.addLayer(layer)
  }
  return group
}

// fitBounds options that keep the target clear of the layer control (top-right)
// and the analysis panels (bottom-left). Leaflet padding is rectangular, so
// this reserves a right strip and a bottom strip.
function fitOptions(maxZoom) {
  const right = (controlEl.value?.offsetWidth ?? 0) + 40
  const bottom = (panelsEl.value?.offsetHeight ?? 0) + 40
  const size = map.getSize()
  // Never reserve so much that nothing is left to fit into.
  return {
    paddingTopLeft: [40, 40],
    paddingBottomRight: [Math.min(right, size.x / 2), Math.min(bottom, size.y * 0.6)],
    maxZoom,
  }
}

function focusZone(z) {
  activeZid.value = z.zid
  const layer = zoneLayers.get(z.zid)
  if (map && layer) {
    map.fitBounds(layer.getBounds(), fitOptions(17))
    layer.openPopup()
  }
}

function applyLayer(key) {
  const layer = layers[key]
  if (!map || !layer) return
  if (visible[key]) {
    layer.addTo(map)
  } else if (map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}

// Swap in a rebuilt data-driven layer, preserving its current visibility.
function replaceLayer(key, layer) {
  if (!map) return
  if (layers[key] && map.hasLayer(layers[key])) map.removeLayer(layers[key])
  layers[key] = layer
  applyLayer(key)
}

const rebuildPoints = () => replaceLayer('points', buildIncidentLayer(mapIncidents.value || []))
const rebuildHeatmap = () => replaceLayer('heatmap', buildHeatmapLayer(kdeCells.value || []))

const rebuildKnox = () =>
  replaceLayer('knox', buildKnoxLayer(knoxResult.value, knoxPoints.value || []))

// The KDE surface and Knox test are the expensive computations, so only run
// them while their layer is on. Filter changes made while a layer is off mark
// it stale; it refreshes the next time it's switched on.
let kdeStale = true
function refreshKde() {
  kdeStale = false
  store.fetchKde()
}

let knoxStale = true
function refreshKnox() {
  knoxStale = false
  knoxStore.run()
}

// New zones: bring them all into view unless they already are (they can sit
// off the default view or under the layer control).
function rebuildPatrol() {
  replaceLayer('patrol', buildPatrolLayer(patrolZones.value || []))
  if (!map || !visible.patrol || !zoneLayers.size) return
  const bounds = L.latLngBounds([])
  for (const layer of zoneLayers.values()) bounds.extend(layer.getBounds())
  const opts = fitOptions(16)
  const tl = map.containerPointToLatLng(opts.paddingTopLeft)
  const size = map.getSize()
  const br = map.containerPointToLatLng([size.x - opts.paddingBottomRight[0], size.y - opts.paddingBottomRight[1]])
  if (!L.latLngBounds(tl, br).contains(bounds)) map.fitBounds(bounds, opts)
}

let patrolStale = true
function refreshPatrol() {
  patrolStale = false
  patrolStore.run()
}

onMounted(() => {
  map = L.map(mapEl.value).setView([AMPAYON.lat, AMPAYON.lng], AMPAYON.zoom)
  // Patrol zones draw above the overlay pane (incident points, 400) but below
  // markers/tooltips/popups.
  map.createPane('patrol').style.zIndex = 450

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)

  // Data-driven layers, rebuilt whenever store data changes.
  rebuildPoints()
  rebuildHeatmap()
  rebuildKnox()
  rebuildPatrol()
  store.fetchMapIncidents()
  if (visible.heatmap) refreshKde()
  if (visible.knox) refreshKnox()
  if (visible.patrol) refreshPatrol()

  // Keep the map sized correctly when the sidebar/layout changes width.
  resizeObserver = new ResizeObserver(() => map && map.invalidateSize())
  resizeObserver.observe(mapEl.value)
  requestAnimationFrame(() => map && map.invalidateSize())
})

watch(mapIncidents, rebuildPoints)
watch(kdeCells, rebuildHeatmap)
watch(knoxResult, rebuildKnox)
// 'post' so the fit measures the panel with the new zone list rendered.
watch(patrolZones, rebuildPatrol, { flush: 'post' })
watch(activeZid, styleZones)

watch(
  visible,
  () => Object.keys(visible).forEach(applyLayer),
  { deep: true }
)

watch(
  () => visible.heatmap,
  (on) => {
    if (on && kdeStale) refreshKde()
  }
)

watch(
  () => visible.knox,
  (on) => {
    if (on && knoxStale) refreshKnox()
  }
)

watch(
  () => visible.patrol,
  (on) => {
    if (on && patrolStale) refreshPatrol()
  }
)

// Filters are shared with the Incidents page; refetch if they change.
watch(filters, () => {
  store.fetchMapIncidents()
  if (visible.heatmap) refreshKde()
  else kdeStale = true
  if (visible.knox) refreshKnox()
  else knoxStale = true
  if (visible.patrol) refreshPatrol()
  else patrolStale = true
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="hotspot-map">
    <div ref="mapEl" class="map"></div>

    <div ref="controlEl" class="control-panel">
      <div class="panel-header">Map Layers</div>
      <label v-for="t in toggles" :key="t.key" class="toggle">
        <span class="toggle-label">{{ t.label }}</span>
        <span class="switch">
          <input type="checkbox" v-model="visible[t.key]" />
          <span class="slider"></span>
        </span>
      </label>

      <div v-if="visible.heatmap" class="legend">
        <div class="legend-bar"></div>
        <div class="legend-labels">
          <span>Low</span>
          <span>{{ kdeLoading ? 'Computing…' : 'Density' }}</span>
          <span>High</span>
        </div>
      </div>

      <div class="panel-status">
        <span v-if="mapLoading">Loading incidents…</span>
        <span v-else>
          {{ mapIncidents.length }} incidents plotted
          <template v-if="hasActiveFilters"> · filtered</template>
        </span>
      </div>
      <div v-if="mapError" class="panel-error">⚠ {{ mapError }}</div>
    </div>

    <div v-if="visible.knox || visible.patrol" ref="panelsEl" class="analysis-panels">
      <PatrolPanel v-if="visible.patrol" :active-zid="activeZid" @focus="focusZone" />
      <KnoxPanel v-if="visible.knox" />
    </div>
  </div>
</template>

<style scoped>
/* Full-bleed: cancel the 24px padding from the content area in App.vue. */
.hotspot-map {
  position: relative;
  margin: -24px;
  height: calc(100% + 48px);
  width: auto;
}

.map {
  height: 100%;
  width: 100%;
  background: var(--bg);
}

/* Bottom-left stack for the Patrol / Knox panels (both can be open). */
.analysis-panels {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 1000;
  width: min(600px, calc(100% - 260px));
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.control-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1000;
  width: 200px;
  background: var(--sidebar);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.panel-header {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  cursor: pointer;
}

.toggle-label {
  font-size: 13px;
  color: var(--text);
}

.switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}

.slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 999px;
  transition: background 0.2s;
}

.slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.switch input:checked + .slider {
  background: var(--accent);
}

.switch input:checked + .slider::before {
  transform: translateX(16px);
}

.legend {
  margin-top: 10px;
}

/* Stops match KDE_RAMP in the script. */
.legend-bar {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right, rgb(253, 224, 71), rgb(249, 115, 22), rgb(220, 38, 38));
}

.legend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.panel-status {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.panel-error {
  margin-top: 8px;
  font-size: 12px;
  color: #f85149;
  word-break: break-word;
}
</style>

<style>
/* Popup styling (unscoped: Leaflet renders popups outside the component tree). */
.leaflet-popup-content .incident-popup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'Inter', sans-serif;
}
.leaflet-popup-content .incident-popup strong {
  color: #e85d04;
  font-size: 14px;
  margin-bottom: 2px;
}
.leaflet-popup-content .incident-popup span {
  font-size: 12px;
  color: #333;
}
.leaflet-popup-content .knox-popup strong {
  color: #6d28d9;
}
.leaflet-popup-content .knox-popup ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.leaflet-popup-content .knox-popup li {
  font-size: 12px;
  color: #333;
  line-height: 1.4;
}
.leaflet-popup-content .patrol-popup strong {
  color: #0f766e;
}
/* Permanent zone-rank labels drawn by Leaflet tooltips. */
.leaflet-tooltip.zone-label {
  background: #2dd4bf;
  border: none;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  color: #0d1117;
  font: 700 11px 'Inter', sans-serif;
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.leaflet-tooltip.zone-label::before {
  display: none;
}
/* Zones sit above the incident points; only the outline takes clicks so the
   points inside stay clickable. */
.leaflet-interactive.patrol-zone {
  pointer-events: visibleStroke;
}
</style>
