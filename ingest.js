/**
 * ingest.js — Load the PNP "8 Focus Crimes" Excel exports into the Supabase
 * `incidents` table.
 *
 * Usage:
 *   1. bun install                        (xlsx + dotenv are in package.json)
 *   2. Add to .env (server-side only):
 *        SUPABASE_URL=https://<ref>.supabase.co
 *        SUPABASE_SERVICE_KEY=<service_role key>
 *   3. Put the .xlsx files in the ./crime_data folder (or set DATA_DIR=/path).
 *      Every .xlsx in that folder is ingested, whatever its filename.
 *   4. bun ingest.js   (preview first with: bun ingest.js --dry-run)
 *      After inserting, it calls refresh_coord_flags() to re-flag bad coordinates
 *      refreshes the persons index (scripts/build-persons.js) and embeds new
 *      narratives (scripts/embed-incidents.js -> embed-incidents Edge Function).
 *
 * The service_role key bypasses Row Level Security, so it MUST stay server-side.
 * Never give it a VITE_ prefix or import it into the browser app.
 */

import 'dotenv/config'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx' // default import: CJS module object, incl. XLSX.SSF
import { createClient } from '@supabase/supabase-js'
import { buildPersons } from './scripts/build-persons.js'
import { embedIncidents } from './scripts/embed-incidents.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- Config -------------------------------------------------------------
// The project URL is not secret (it's also the app's VITE_SUPABASE_URL), so fall
// back to it. The service_role key must only ever be the non-VITE SUPABASE_SERVICE_KEY.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const { SUPABASE_SERVICE_KEY } = process.env
// Default to ./crime_data if it exists, else next to this script. Override with DATA_DIR.
const DEFAULT_DIR = existsSync(resolve(__dirname, 'crime_data'))
  ? resolve(__dirname, 'crime_data')
  : __dirname
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : DEFAULT_DIR
const BATCH_SIZE = 100

// Excel header -> incidents column. Keys are the actual headers used in the PNP
// "8 Focus Crimes" exports (camelCase), matched case-insensitively. The export
// has ~92 columns; only the ones below exist in the incidents table are mapped.
const COLUMN_MAP = {
  blotterno: 'blotterno',
  dateEncoded: 'date_encoded',
  region: 'region',
  ppo: 'ppo',
  stn: 'stn',
  municipal: 'municipal',
  barangay: 'barangay',
  street: 'street',
  typeofPlace: 'type_of_place',
  dateReported: 'date_reported',
  timeReported: 'time_reported',
  dateCommitted: 'date_committed',
  timeCommitted: 'time_committed',
  incidentType: 'incident_type',
  offense: 'offense',
  offenseType: 'offense_type',
  modus: 'modus',
  victim: 'victim_raw',
  suspect: 'suspect_raw',
  narrative: 'narrative',
  casestatus: 'case_status',
  caseSolveType: 'case_solve_type',
  lat: 'lat',
  lng: 'lng',
}

// Type coercion groups (everything else is treated as trimmed text).
const DATE_COLS = new Set(['date_reported', 'date_committed'])
const TIME_COLS = new Set(['time_reported', 'time_committed'])
const TIMESTAMP_COLS = new Set(['date_encoded'])
const NUM_COLS = new Set(['lat', 'lng'])

// --- Header matching ----------------------------------------------------
function normalizeHeader(h) {
  return String(h).replace(/\s+/g, ' ').trim().replace(/\.+$/, '').toUpperCase()
}
const NORMALIZED_MAP = {}
for (const [header, col] of Object.entries(COLUMN_MAP)) {
  NORMALIZED_MAP[normalizeHeader(header)] = col
}

// --- Value coercion -----------------------------------------------------
const pad = (n) => String(n).padStart(2, '0')

function str(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function parseNum(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

// Excel stores dates/times as serial numbers; SSF.parse_date_code is timezone-safe.
function partsFromSerial(serial) {
  const p = XLSX.SSF.parse_date_code(serial)
  return p && p.y ? p : null
}

function applyMeridiem(h, ap) {
  if (!ap) return h
  const u = ap.toUpperCase()
  if (u === 'PM' && h < 12) return h + 12
  if (u === 'AM' && h === 12) return 0
  return h
}

// Parse a TEXT date / datetime cell into {y,m,d,H,M,S}, or null if unparseable.
// PH convention is DD/MM/YYYY for numeric slash/dash/dot formats; ISO YYYY-MM-DD
// is also recognized. A trailing time (24h or AM/PM) is optional. This is only
// reached for cells stored as strings — real Excel date cells arrive as serial
// numbers and go through partsFromSerial() instead.
const TIME_RE = '(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([AaPp][Mm])?)?'
function parseStringDateTime(value) {
  const s = String(value).trim()
  if (!s) return null
  let y, mo, d
  // ISO first: YYYY-MM-DD
  let m = s.match(new RegExp('^(\\d{4})-(\\d{1,2})-(\\d{1,2})' + TIME_RE))
  if (m) {
    y = +m[1]
    mo = +m[2]
    d = +m[3]
  } else {
    // DD/MM/YYYY (also DD-MM-YYYY, DD.MM.YYYY) — day FIRST (PH format).
    m = s.match(new RegExp('^(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{2,4})' + TIME_RE))
    if (!m) return null
    d = +m[1]
    mo = +m[2]
    y = +m[3]
    if (y < 100) y += 2000 // 2-digit year -> 20xx
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  let H = m[4] != null ? +m[4] : 0
  const M = m[5] != null ? +m[5] : 0
  const S = m[6] != null ? +m[6] : 0
  H = applyMeridiem(H, m[7])
  if (H > 23 || M > 59 || S > 59) return null
  return { y, m: mo, d, H, M, S }
}

function parseDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  }
  if (typeof v === 'number') {
    const p = partsFromSerial(v)
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null
  }
  const p = parseStringDateTime(v)
  if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`
  // Non-numeric textual dates (e.g. "May 9, 2023") — unambiguous, let Date handle.
  const d = new Date(String(v))
  return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Export timestamps are Philippine Standard Time (UTC+8, no DST). date_encoded is
// a timestamptz, so the offset must be explicit or Postgres reads it as UTC.
const PH_OFFSET = '+08:00'

function parseTimestamp(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString()
  if (typeof v === 'number') {
    const p = partsFromSerial(v)
    if (!p) return null
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}:${pad(Math.floor(p.S))}${PH_OFFSET}`
  }
  const p = parseStringDateTime(v)
  if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}:${pad(p.S)}${PH_OFFSET}`
  const d = new Date(String(v))
  return isNaN(d) ? null : d.toISOString()
}

function parseTime(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`
  }
  if (typeof v === 'number') {
    // Time-only cells are fractional-day serials (< 1); parse_date_code still
    // returns the H/M/S components.
    const p = XLSX.SSF.parse_date_code(v)
    return p ? `${pad(p.H)}:${pad(p.M)}:${pad(Math.floor(p.S))}` : null
  }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = m[3] ? parseInt(m[3], 10) : 0
  const ap = m[4] && m[4].toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  if (h > 23 || min > 59 || sec > 59) return null
  return `${pad(h)}:${pad(min)}:${pad(sec)}`
}

function coerce(col, v) {
  if (DATE_COLS.has(col)) return parseDate(v)
  if (TIME_COLS.has(col)) return parseTime(v)
  if (TIMESTAMP_COLS.has(col)) return parseTimestamp(v)
  if (NUM_COLS.has(col)) return parseNum(v)
  return str(v)
}

function mapRow(row) {
  const rec = {}
  for (const col of Object.values(NORMALIZED_MAP)) rec[col] = null
  for (const [rawKey, val] of Object.entries(row)) {
    const col = NORMALIZED_MAP[normalizeHeader(rawKey)]
    if (col) rec[col] = coerce(col, val)
  }
  return rec
}

// --- Reading ------------------------------------------------------------
// Every .xlsx in DATA_DIR is ingested, whatever it's named (ignoring Excel's
// temporary ~$ lock files). Returns filenames sorted for stable ordering.
function findWorkbooks() {
  return readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort()
}

// PNP exports often carry a banner/title row above the real header, so locate
// the header row by matching known column names rather than assuming row 1.
function readWorkbook(filePath) {
  const buf = readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  const headerIdx = matrix.findIndex(
    (r) =>
      Array.isArray(r) &&
      r.filter((c) => NORMALIZED_MAP[normalizeHeader(c ?? '')]).length >= 3
  )
  if (headerIdx === -1) return { sheetName, rows: [], headerRow: null }

  const headers = matrix[headerIdx]
  const rows = []
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const arr = matrix[i]
    if (!Array.isArray(arr) || arr.every((c) => c == null || c === '')) continue
    const obj = {}
    headers.forEach((h, j) => {
      if (h != null && h !== '') obj[h] = arr[j] ?? null
    })
    rows.push(obj)
  }
  return { sheetName, rows, headerRow: headerIdx + 1 }
}

// --- Main ---------------------------------------------------------------
async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')

  // Credentials are only needed for a real insert, not a dry run.
  if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
    console.error(
      'ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Add them to .env (use the service_role key).'
    )
    process.exit(1)
  }

  if (!existsSync(DATA_DIR)) {
    console.error(`ERROR: data folder not found: ${DATA_DIR}`)
    process.exit(1)
  }

  console.log(`Reading Excel files from: ${DATA_DIR}`)
  const files = findWorkbooks()
  if (files.length === 0) {
    console.log('No .xlsx files found in that folder. Nothing to insert.')
    return
  }

  const allRecords = []
  for (const file of files) {
    const { sheetName, rows, headerRow } = readWorkbook(resolve(DATA_DIR, file))
    if (rows.length === 0) {
      console.warn(`  WARN: ${file} (sheet "${sheetName}") - no header row matched, 0 rows.`)
      continue
    }
    allRecords.push(...rows.map(mapRow))
    console.log(
      `  OK: ${file} (sheet "${sheetName}", header on row ${headerRow}): ${rows.length} data rows`
    )
  }

  if (allRecords.length === 0) {
    console.log('No rows found. Nothing to insert.')
    return
  }

  // De-duplicate within this run by (blotterno, offense) — one blotter entry can
  // have multiple offenses, so blotterno alone is NOT unique. The composite UNIQUE
  // constraint + ON CONFLICT DO NOTHING handles rows already in the table.
  // Rows without a blotterno cannot be de-duplicated and insert on every run.
  const seen = new Set()
  let dupes = 0
  const records = []
  for (const rec of allRecords) {
    if (rec.blotterno) {
      const key = `${rec.blotterno}||${rec.offense ?? ''}`
      if (seen.has(key)) {
        dupes++
        continue
      }
      seen.add(key)
    }
    records.push(rec)
  }

  console.log(`\nTotal rows read: ${allRecords.length}`)
  if (dupes) console.log(`Duplicate (blotterno, offense) within files (skipped pre-insert): ${dupes}`)
  console.log(`Rows to insert: ${records.length}\n`)

  // --dry-run / DRY_RUN=1: preview the mapped output, do not touch the database.
  if (dryRun) {
    console.log('DRY RUN - sample of first mapped record(s), nothing inserted:\n')
    console.log(JSON.stringify(records.slice(0, 3), null, 2))
    return
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let inserted = 0
  let skipped = 0
  let failed = 0
  const totalBatches = Math.ceil(records.length / BATCH_SIZE)

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const batchNo = Math.floor(i / BATCH_SIZE) + 1

    // ignoreDuplicates -> INSERT ... ON CONFLICT (blotterno, offense) DO NOTHING.
    // .select() returns only the rows actually inserted, so we can count skips.
    const { data, error } = await supabase
      .from('incidents')
      .upsert(batch, { onConflict: 'blotterno,offense', ignoreDuplicates: true })
      .select('blotterno')

    if (error) {
      failed += batch.length
      console.error(`  Batch ${batchNo}/${totalBatches}: ERROR ${error.message}`)
      continue
    }

    const ins = data ? data.length : 0
    inserted += ins
    skipped += batch.length - ins
    console.log(
      `  Batch ${batchNo}/${totalBatches}: ${ins} inserted, ${batch.length - ins} skipped (duplicate)`
    )
  }

  console.log(
    `\nDone. Inserted: ${inserted}, Skipped (duplicate): ${skipped}, Failed: ${failed}`
  )

  // Re-flag missing/stacked coordinates so new rows are excluded from KDE and
  // the map (see supabase/migrations/20260914100000_analysis_prep.sql).
  const { data: flags, error: flagErr } = await supabase.rpc('refresh_coord_flags')
  if (flagErr) {
    console.error(`  WARN: refresh_coord_flags() failed: ${flagErr.message}`)
  } else {
    const summary = (flags || []).map((f) => `${f.flag}: ${f.rows}`).join(', ')
    console.log(`Coordinate flags refreshed (${summary || 'none flagged'})`)
  }

  // Parse suspects/victims of new or changed rows into the persons index.
  try {
    await buildPersons(supabase)
  } catch (e) {
    console.error(`  WARN: persons index not refreshed: ${e.message}. Run: bun scripts/build-persons.js`)
  }

  // Embed new narratives for similar-incident search (embed-incidents Edge Function).
  try {
    await embedIncidents(supabase)
  } catch (e) {
    console.error(`  WARN: narratives not embedded: ${e.message}. Run: bun scripts/embed-incidents.js`)
  }

  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
