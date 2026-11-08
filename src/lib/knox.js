/**
 * Knox space-time test with Monte Carlo significance — the method of
 * Ratcliffe's Near Repeat Calculator.
 *
 * Every pair of incidents is classified by its distance band (rows) and its
 * time band (columns). The observed pair count in each cell is compared with
 * the counts obtained after randomly re-assigning the incident dates among the
 * locations (`iterations` times), which breaks any space-time link while
 * keeping both the spatial pattern and the timeline intact.
 *
 *   ratio = observed / mean(permuted)          (> 1 = more pairs than chance)
 *   p     = (1 + #{permuted >= observed}) / (iterations + 1)   (one-sided)
 *
 * Rows:    "Same location" (< 1 m), then (k-1)·s .. k·s for k = 1..spatialBands,
 *          then "More than" spatialBands·s.
 * Columns: 0..t days, then (k·t, (k+1)·t] for k = 1..temporalBands-1,
 *          then "More than" temporalBands·t days.
 *
 * Points carry planar coordinates in metres (x, y — UTM 51N from PostGIS) and
 * `day`, an integer day number (date_committed as days since the epoch).
 *
 * Pure and synchronous: runs in a Web Worker in the app and directly under Bun
 * in tests.
 */

export const DEFAULT_OPTIONS = {
  spatialBand: 100, // metres
  spatialBands: 5,
  temporalBand: 7, // days
  temporalBands: 5,
  iterations: 99,
  seed: 20230101, // fixed so the same data always gives the same p-values
  // Near-repeat links drawn on the map: pairs within both limits.
  linkDistance: null, // defaults to spatialBand
  linkDays: null, // defaults to temporalBand
  minClusterSize: 2,
}

// Small, fast, seedable PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function knoxTest(points, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options }
  const S = o.spatialBands
  const T = o.temporalBands
  const s = o.spatialBand
  const t = o.temporalBand
  const maxD = S * s
  const rows = S + 2 // same location, S bands, beyond
  const cols = T + 1 // T bands, beyond
  const n = points.length

  const sBand = (d) => (d < 1 ? 0 : Math.min(S + 1, Math.ceil(d / s)))
  const tBand = (dt) => (dt <= t ? 0 : Math.min(T, Math.ceil(dt / t) - 1))

  const xs = Float64Array.from(points, (p) => p.x)
  const ys = Float64Array.from(points, (p) => p.y)
  const days = Int32Array.from(points, (p) => p.day)

  // Pairs within maxD, stored once; everything else lands in the "beyond" row.
  const pi = []
  const pj = []
  const pBand = []
  const pDist = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[i] - xs[j]
      const dy = ys[i] - ys[j]
      const d2 = dx * dx + dy * dy
      if (d2 <= maxD * maxD) {
        const d = Math.sqrt(d2)
        pi.push(i)
        pj.push(j)
        pBand.push(sBand(d))
        pDist.push(d)
      }
    }
  }
  const P = pi.length
  const PI = Int32Array.from(pi)
  const PJ = Int32Array.from(pj)
  const PB = Uint8Array.from(pBand)

  // The time-band distribution over ALL pairs doesn't change when dates are
  // permuted among points, so the "beyond" row is column total minus the rest.
  const colTotals = new Float64Array(cols)
  {
    const sorted = Int32Array.from(days).sort()
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) colTotals[tBand(sorted[j] - sorted[i])]++
    }
  }

  function countCells(dayArr) {
    const c = new Float64Array(rows * cols)
    for (let k = 0; k < P; k++) {
      c[PB[k] * cols + tBand(Math.abs(dayArr[PI[k]] - dayArr[PJ[k]]))]++
    }
    // Beyond row = column total minus all rows within maxD.
    for (let col = 0; col < cols; col++) {
      let within = 0
      for (let r = 0; r <= S; r++) within += c[r * cols + col]
      c[(S + 1) * cols + col] = colTotals[col] - within
    }
    return c
  }

  const observed = countCells(days)

  // Monte Carlo: shuffle dates among locations.
  const random = rng(o.seed)
  const perm = Int32Array.from(days)
  const sum = new Float64Array(rows * cols)
  const atLeast = new Float64Array(rows * cols)
  for (let it = 0; it < o.iterations; it++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const tmp = perm[i]
      perm[i] = perm[j]
      perm[j] = tmp
    }
    const c = countCells(perm)
    for (let k = 0; k < c.length; k++) {
      sum[k] += c[k]
      if (c[k] >= observed[k]) atLeast[k]++
    }
  }

  const sLabel = (r) => {
    if (r === 0) return 'Same location'
    if (r === S + 1) return `More than ${maxD} m`
    return `${r === 1 ? 1 : (r - 1) * s + 1} to ${r * s} m`
  }
  const tLabel = (col) => {
    if (col === T) return `More than ${T * t} days`
    return `${col === 0 ? 0 : col * t + 1} to ${(col + 1) * t} days`
  }

  const table = []
  for (let r = 0; r < rows; r++) {
    const cells = []
    for (let col = 0; col < cols; col++) {
      const k = r * cols + col
      const expected = o.iterations ? sum[k] / o.iterations : 0
      cells.push({
        observed: observed[k],
        expected,
        ratio: expected > 0 ? observed[k] / expected : null,
        p: (1 + atLeast[k]) / (o.iterations + 1),
      })
    }
    table.push({ label: sLabel(r), cells })
  }

  // Near-repeat links (real dates) and the clusters they chain into.
  const linkD = o.linkDistance ?? s
  const linkT = o.linkDays ?? t
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const links = []
  for (let k = 0; k < P; k++) {
    if (pDist[k] <= linkD && Math.abs(days[PI[k]] - days[PJ[k]]) <= linkT) {
      links.push([PI[k], PJ[k]])
      const a = find(PI[k])
      const b = find(PJ[k])
      if (a !== b) parent[a] = b
    }
  }

  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  }
  const clusters = []
  for (const members of groups.values()) {
    if (members.length < o.minClusterSize) continue
    let cx = 0
    let cy = 0
    for (const i of members) {
      cx += xs[i]
      cy += ys[i]
    }
    cx /= members.length
    cy /= members.length
    let radius = 0
    let dayMin = Infinity
    let dayMax = -Infinity
    for (const i of members) {
      radius = Math.max(radius, Math.hypot(xs[i] - cx, ys[i] - cy))
      dayMin = Math.min(dayMin, days[i])
      dayMax = Math.max(dayMax, days[i])
    }
    clusters.push({ members, radius, dayMin, dayMax })
  }
  clusters.sort((a, b) => b.members.length - a.members.length || a.dayMin - b.dayMin)

  return {
    n,
    totalPairs: (n * (n - 1)) / 2,
    pairsWithin: P,
    iterations: o.iterations,
    options: { ...o, linkDistance: linkD, linkDays: linkT },
    columns: Array.from({ length: cols }, (_, c) => tLabel(c)),
    table,
    links,
    clusters,
  }
}
