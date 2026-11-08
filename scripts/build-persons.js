/**
 * Build / refresh the persons index from incidents.suspect_raw / victim_raw.
 * Server-side only (service key, like ingest.js); ingest.js runs it after
 * every load. Safe to re-run:
 *   - only (incident, role) texts that changed since the last run are re-parsed
 *     (md5 of the source text), so investigators' merges/splits on unchanged
 *     records are never undone;
 *   - new mentions are linked automatically ONLY to a person with the same
 *     normalised name + suffix, compatible sex, and an estimated birth year
 *     within BIRTH_YEAR_SLACK; anything fuzzier is left for investigators
 *     (person_match_candidates in the app);
 *   - placeholders (UNIDENTIFIED, JOHN DOE, …) are stored but never linked;
 *   - persons left with no mentions are deleted;
 *   - similar-name pairs (person_pairs) are recomputed for the match queue.
 *
 * Usage: bun scripts/build-persons.js [--dry-run]
 * Requires the persons_index migration and SUPABASE_SERVICE_KEY in .env.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { parsePersons, similarPairs } from './lib/persons.js'

const ROLES = ['suspect', 'victim']
const BIRTH_YEAR_SLACK = 3 // ages in blotters are often off by a year or two
const PAGE = 1000
const BATCH = 500
const PAIR_MIN_SIMILARITY = 0.45 // stored pairs; the app shows >= 0.5 by default

const md5 = (s) => createHash('md5').update(s || '').digest('hex')
const keyOf = (m) => `${m.nameNorm || m.name_norm}|${m.suffix || ''}`

async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size))
}

export async function buildPersons(supabase, { dryRun = false, log = console.log } = {}) {
  const incidents = await fetchAll(() =>
    supabase.from('incidents').select('id, blotterno, date_committed, suspect_raw, victim_raw').order('id')
  )
  const mentions = await fetchAll(() =>
    supabase
      .from('incident_persons')
      .select('id, incident_id, role, source_hash, person_id, placeholder, name_norm, suffix, sex, est_birth_year')
      .order('id')
  )
  const persons = await fetchAll(() => supabase.from('persons').select('id, name_norm, suffix, sex').order('id'))

  // --- Which (incident, role) groups need (re)parsing? ---
  const groups = new Map() // `${incident}|${role}` -> { hash, rows }
  for (const m of mentions) {
    const k = `${m.incident_id}|${m.role}`
    if (!groups.has(k)) groups.set(k, { hash: m.source_hash, rows: [] })
    groups.get(k).rows.push(m)
  }

  const staleIds = []
  const fresh = [] // parsed mentions to insert
  for (const inc of incidents) {
    const year = inc.date_committed ? Number(inc.date_committed.slice(0, 4)) : null
    for (const role of ROLES) {
      const raw = inc[`${role}_raw`] || ''
      const hash = md5(raw)
      const g = groups.get(`${inc.id}|${role}`)
      // Unchanged and fully linked: leave alone (keeps investigator decisions).
      const unlinked = g?.rows.some((r) => !r.placeholder && r.name_norm && r.person_id == null)
      if (g && g.hash === hash && !unlinked) continue
      if (g) staleIds.push(...g.rows.map((r) => r.id))
      for (const p of parsePersons(raw)) {
        fresh.push({
          ...p,
          incidentId: inc.id,
          blotter: inc.blotterno || inc.id,
          role,
          hash,
          estBirthYear: year && p.age != null ? year - p.age : null,
        })
      }
    }
  }

  // --- Person index from the mentions that stay ---
  const stale = new Set(staleIds)
  const people = new Map() // person id -> { id, key, sex, byMin, byMax }
  for (const p of persons) people.set(p.id, { id: p.id, key: keyOf(p), sex: p.sex, byMin: null, byMax: null })
  for (const m of mentions) {
    if (stale.has(m.id) || m.person_id == null) continue
    const p = people.get(m.person_id)
    if (!p) continue
    p.sex = p.sex || m.sex
    if (m.est_birth_year != null) {
      p.byMin = p.byMin == null ? m.est_birth_year : Math.min(p.byMin, m.est_birth_year)
      p.byMax = p.byMax == null ? m.est_birth_year : Math.max(p.byMax, m.est_birth_year)
    }
  }
  const byKey = new Map()
  for (const p of people.values()) {
    if (!byKey.has(p.key)) byKey.set(p.key, [])
    byKey.get(p.key).push(p)
  }

  // Years outside the person's birth-year range (0 = inside; null = unknown).
  const gap = (p, y) => (y == null || p.byMin == null ? 0 : Math.max(0, p.byMin - y, y - p.byMax))
  const compatible = (p, m) => (!p.sex || !m.sex || p.sex === m.sex) && gap(p, m.estBirthYear) <= BIRTH_YEAR_SLACK

  // --- Assign: one decision per (blotter, role, name) unit ---
  const newPeople = [] // { tmp, key, sex, byMin, byMax, displayName, nameNorm, suffix }
  const unitPerson = new Map()
  let linkedExisting = 0
  for (const m of fresh) {
    if (m.placeholder || !m.nameNorm) continue
    const unit = `${m.blotter}|${m.role}|${keyOf(m)}`
    if (unitPerson.has(unit)) {
      m.person = unitPerson.get(unit)
      continue
    }
    const candidates = (byKey.get(keyOf(m)) || []).filter((p) => compatible(p, m))
    candidates.sort((a, b) => gap(a, m.estBirthYear) - gap(b, m.estBirthYear))
    let person = candidates[0]
    if (person) {
      if (person.id) linkedExisting++
    } else {
      person = {
        tmp: newPeople.length,
        key: keyOf(m),
        sex: m.sex,
        byMin: null,
        byMax: null,
        displayName: [m.name, m.suffix].filter(Boolean).join(' '),
        nameNorm: m.nameNorm,
        suffix: m.suffix,
      }
      newPeople.push(person)
      if (!byKey.has(person.key)) byKey.set(person.key, [])
      byKey.get(person.key).push(person)
    }
    person.sex = person.sex || m.sex
    if (m.estBirthYear != null) {
      person.byMin = person.byMin == null ? m.estBirthYear : Math.min(person.byMin, m.estBirthYear)
      person.byMax = person.byMax == null ? m.estBirthYear : Math.max(person.byMax, m.estBirthYear)
    }
    unitPerson.set(unit, person)
    m.person = person
  }

  log(
    `persons: ${incidents.length} incidents; ${staleIds.length} stale mentions; ${fresh.length} mentions to write; ` +
      `${newPeople.length} new persons; ${linkedExisting} linked to existing persons`
  )
  if (dryRun) return { fresh: fresh.length, newPersons: newPeople.length, stale: staleIds.length }

  // --- Write: new persons (ids in insert order, verified), then mentions ---
  await inBatches(newPeople, BATCH, async (batch) => {
    const { data, error } = await supabase
      .from('persons')
      .insert(batch.map((p) => ({ display_name: p.displayName, name_norm: p.nameNorm, suffix: p.suffix, sex: p.sex })))
      .select('id, name_norm')
    if (error) throw error
    data.forEach((row, i) => {
      if (row.name_norm !== batch[i].nameNorm) throw new Error('persons insert returned rows out of order')
      batch[i].id = row.id
    })
  })

  await inBatches(staleIds, BATCH, async (ids) => {
    const { error } = await supabase.from('incident_persons').delete().in('id', ids)
    if (error) throw error
  })

  await inBatches(fresh, BATCH, async (batch) => {
    const { error } = await supabase.from('incident_persons').insert(
      batch.map((m) => ({
        incident_id: m.incidentId,
        role: m.role,
        position: m.position,
        raw: m.raw,
        name: m.name,
        name_norm: m.nameNorm || null,
        suffix: m.suffix,
        alias: m.alias,
        age: m.age,
        sex: m.sex,
        status: m.status,
        nationality: m.nationality,
        occupation: m.occupation,
        placeholder: m.placeholder,
        est_birth_year: m.estBirthYear,
        source_hash: m.hash,
        person_id: m.person?.id ?? null,
      }))
    )
    if (error) throw error
  })

  // --- Drop persons nobody references any more ---
  const used = new Set(
    (await fetchAll(() => supabase.from('incident_persons').select('person_id').not('person_id', 'is', null).order('id'))).map(
      (r) => r.person_id
    )
  )
  const orphans = (await fetchAll(() => supabase.from('persons').select('id').order('id')))
    .map((p) => p.id)
    .filter((id) => !used.has(id))
  await inBatches(orphans, BATCH, async (ids) => {
    const { error } = await supabase.from('persons').delete().in('id', ids)
    if (error) throw error
  })

  log(`persons: wrote ${fresh.length} mentions, ${newPeople.length} new persons, removed ${orphans.length} orphans`)

  // --- Similar-name pairs for the match queue (recomputed in full; cheap) ---
  const current = (await fetchAll(() => supabase.from('persons').select('id, name_norm, sex').order('id'))).map((p) => ({
    id: p.id,
    nameNorm: p.name_norm,
    sex: p.sex,
  }))
  const pairs = similarPairs(current, PAIR_MIN_SIMILARITY)
  const { error: clearErr } = await supabase.from('person_pairs').delete().gte('person_a', 0)
  if (clearErr) throw clearErr
  await inBatches(pairs, BATCH, async (batch) => {
    const { error } = await supabase
      .from('person_pairs')
      .insert(batch.map((p) => ({ person_a: p.a, person_b: p.b, similarity: p.similarity })))
    if (error) throw error
  })
  log(`persons: ${pairs.length} similar-name pairs for review`)

  return {
    fresh: fresh.length,
    newPersons: newPeople.length,
    stale: staleIds.length,
    orphans: orphans.length,
    pairs: pairs.length,
  }
}

if (import.meta.main) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  buildPersons(supabase, { dryRun: process.argv.includes('--dry-run') }).catch((e) => {
    console.error('Failed:', e.message || e)
    process.exit(1)
  })
}
