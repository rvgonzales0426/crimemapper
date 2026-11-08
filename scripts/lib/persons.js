// Parse the blotter's suspect_raw / victim_raw text into people.
//
// Source format (PNP blotter export), several people comma-separated:
//   NAME NAME NAME (age/sex/status/nationality/occupation), NAME ... (...)
// The status can itself contain parentheses, e.g. "Released (No Complainant)",
// so splitting respects nesting. Pure functions: used by build-persons.js and
// runnable under Bun for tests.

const PLACEHOLDER_NAMES = new Set([
  '',
  'UNIDENTIFIED',
  'UNKNOWN',
  'NONE',
  'NA',
  'N A',
  'JOHN DOE',
  'JANE DOE',
  'UNIDENTIFIED PERSON',
  'UNIDENTIFIED PERSONS',
  'UNIDENTIFIED SUSPECT',
  'UNIDENTIFIED SUSPECTS',
  'UNIDENTIFIED MALE',
  'UNIDENTIFIED FEMALE',
  'UNKNOWN PERSON',
  'UNKNOWN SUSPECT',
  'UNKNOWN DRIVER',
  'UNIDENTIFIED DRIVER',
])
const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V'])

// Split on `delim` only outside parentheses.
export function splitTopLevel(s, delim) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === delim && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

// Text inside the first top-level (...) and the text before it.
function splitNameAndDetails(chunk) {
  const open = chunk.indexOf('(')
  if (open < 0) return { name: chunk, details: null }
  let depth = 0
  for (let i = open; i < chunk.length; i++) {
    if (chunk[i] === '(') depth++
    else if (chunk[i] === ')' && --depth === 0) {
      return { name: chunk.slice(0, open), details: chunk.slice(open + 1, i) }
    }
  }
  return { name: chunk.slice(0, open), details: chunk.slice(open + 1) } // unclosed
}

// Upper-case, strip accents/punctuation, collapse spaces; pull out JR/SR/II…
export function normalizeName(name) {
  const words = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const suffix = words.filter((w) => SUFFIXES.has(w)).join(' ') || null
  const norm = words.filter((w) => !SUFFIXES.has(w)).join(' ')
  return { norm, suffix }
}

export function isPlaceholder(norm) {
  return PLACEHOLDER_NAMES.has(norm) || /^(UNIDENTIFIED|UNKNOWN)\b/.test(norm)
}

// "JUAN DELA CRUZ @ JUNJUN" / "JUAN DELA CRUZ ALIAS JUNJUN" / 'JUAN "JUNJUN" DELA CRUZ'
function splitAlias(name) {
  let alias = null
  let rest = name
  const quoted = rest.match(/["“”']([^"“”']{2,})["“”']/)
  if (quoted) {
    alias = quoted[1].trim()
    rest = rest.replace(quoted[0], ' ')
  }
  const m = rest.match(/^(.*?)(?:\s+@\s*|\s+A\.?K\.?A\.?\s+|\s+ALIAS\s+)(.+)$/i)
  if (m) {
    rest = m[1]
    alias = alias || m[2].trim()
  }
  return { name: rest.replace(/\s+/g, ' ').trim(), alias }
}

function parseSex(s) {
  const v = (s || '').trim().toUpperCase()
  if (v === 'MALE' || v === 'M') return 'M'
  if (v === 'FEMALE' || v === 'F') return 'F'
  return null
}

// Trigram set the way pg_trgm builds it: alphanumeric words, lower-cased,
// each padded with two spaces in front and one behind.
export function trigrams(s) {
  const set = new Set()
  for (const w of (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const p = `  ${w} `
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3))
  }
  return set
}

// pg_trgm similarity(): shared trigrams / all distinct trigrams.
export function trigramSimilarity(a, b) {
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  const union = a.size + b.size - shared
  return union ? shared / union : 0
}

// All pairs of people whose names are at least `min` alike and whose sex
// doesn't conflict. people: [{ id, nameNorm, sex }] -> [{ a, b, similarity }] with a < b.
export function similarPairs(people, min = 0.45) {
  const tg = people.map((p) => trigrams(p.nameNorm))
  const out = []
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const pi = people[i]
      const pj = people[j]
      if (pi.sex && pj.sex && pi.sex !== pj.sex) continue
      const sim = trigramSimilarity(tg[i], tg[j])
      if (sim >= min) {
        out.push({ a: Math.min(pi.id, pj.id), b: Math.max(pi.id, pj.id), similarity: Math.round(sim * 1000) / 1000 })
      }
    }
  }
  return out
}

// One person per comma-separated chunk. Chunks with no name and no details
// (stray commas) are dropped.
export function parsePersons(raw) {
  if (!raw || !raw.trim()) return []
  return splitTopLevel(raw, ',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((chunk, position) => {
      const { name: namePart, details } = splitNameAndDetails(chunk)
      const { name, alias } = splitAlias(namePart.trim())
      const f = details ? splitTopLevel(details, '/').map((x) => x.trim()) : []
      const age = /^\d{1,3}$/.test(f[0] || '') ? Number(f[0]) : null
      const { norm, suffix } = normalizeName(name)
      return {
        position,
        raw: chunk,
        name: name || null,
        nameNorm: norm,
        suffix,
        alias,
        age: age != null && age > 0 && age < 120 ? age : null,
        sex: parseSex(f[1]),
        status: f[2] || null,
        nationality: f[3] || null,
        occupation: f.slice(4).join('/').trim() || null,
        placeholder: isPlaceholder(norm),
      }
    })
    .filter((p) => p.name || p.age != null || p.status)
}
