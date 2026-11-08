// Edge Function: case assistant (Groq-hosted open-weight model with database tools).
//
// - Runs as the signed-in officer: every tool queries Supabase with the
//   caller's JWT, so Row Level Security decides what the model can see.
//   Requires a role with /investigations; person tools also need /persons.
// - Names are masked before anything is sent to Groq: people named on the
//   incidents a tool returns are replaced with tokens (P123 = persons.id).
//   The browser gets the token -> name map back only if it may see Persons.
// - The model must cite blotters and use "named as suspect" language; it must
//   not profile people by demographics.
// - Every call is logged in ai_requests (admins can read it).
//
// Secrets: GROQ_API_KEY (required); GROQ_MODEL / GROQ_FALLBACK_MODEL optional.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } }
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq retired llama-3.3-70b-versatile / llama-3.1-8b-instant on the free tier
// (16 Aug 2026); these are its recommended replacements. Override via secrets.
const MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b'
const FALLBACK_MODEL = Deno.env.get('GROQ_FALLBACK_MODEL') ?? 'openai/gpt-oss-20b'
const MAX_STEPS = 5
const MAX_TOOL_CHARS = 4000 // keep each tool result small: the free tier has a low tokens-per-minute cap
const SEARCH_COLUMNS = ['blotterno', 'barangay', 'offense', 'incident_type', 'victim_raw', 'suspect_raw', 'narrative', 'case_status']
const INCIDENT_COLS = 'id, blotterno, date_committed, time_committed, barangay, street, type_of_place, offense, incident_type, modus, case_status'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM_PROMPT = `You are an analysis assistant for investigators at PNP Butuan City Police Station 4.
Rules:
- Use the tools to look things up. Answer only from tool results; never invent facts, people, dates or blotter numbers.
- Cite the blotter number in square brackets, like [2024-00123], after every factual statement.
- People appear as tokens such as P123. Use the tokens exactly as given and never guess a real name.
- Being named in a blotter is not proof of guilt. Say "named as suspect", not "offender" or "criminal".
- Do not profile or predict who will commit crimes from age, sex, occupation, ethnicity or similar traits. If asked, decline in one sentence and offer what you can do instead.
- If the tools do not contain the answer, say so plainly.
- Be concise: short paragraphs or bullet points. Plain text, no tables.`

let embedder: { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } | null = null
async function embed(text: string): Promise<number[]> {
  embedder ??= new Supabase.ai.Session('gte-small')
  return await embedder.run(text.slice(0, 2000), { mean_pool: true, normalize: true })
}

const sanitize = (s: string) => s.replace(/[,()*]/g, ' ').trim()
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : null)
const offenseName = (s: string | null) => (s ? s.split(' - ')[0].replace(/\s+/g, ' ').trim() : null)

// ---------- Name masking ----------
const PARTICLES = new Set(['DE', 'DEL', 'DELA', 'DELOS', 'DE LOS', 'DELAS', 'SAN', 'STA', 'STO', 'MC', 'MAC'])
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

class Masker {
  private patterns: { re: RegExp; token: string }[] = []
  private seen = new Set<number | string>()
  people: Record<string, string> = {}
  constructor(private admin: SupabaseClient) {}

  private add(name: string, token: string) {
    const words = name.toUpperCase().replace(/[^A-ZÑ ]+/g, ' ').split(/\s+/).filter(Boolean)
    if (words.length < 2) return
    // Surname may be multi-word ("DELA CRUZ"): start at the first particle after the first name.
    let s = words.length - 1
    for (let i = 1; i < words.length - 1; i++) if (PARTICLES.has(words[i])) { s = i; break }
    const variants = new Set([words.join(' '), [words[0], ...words.slice(s)].join(' ')])
    for (const v of variants) {
      const re = new RegExp(`\\b${v.split(' ').map(escapeRe).join('[\\s.,]+(?:[A-Z]\\.?\\s+)?')}\\b`, 'gi')
      this.patterns.push({ re, token })
    }
    this.patterns.sort((a, b) => b.re.source.length - a.re.source.length) // longest first
  }

  // Register everyone named on these incidents (service role: masking only).
  async load(incidentIds: string[]) {
    const ids = incidentIds.filter((id) => !this.seen.has(id))
    if (!ids.length) return
    ids.forEach((id) => this.seen.add(id))
    const { data } = await this.admin
      .from('incident_persons')
      .select('incident_id, role, name, alias, placeholder, person_id')
      .in('incident_id', ids)
    for (const m of data ?? []) {
      if (m.placeholder || !m.name) continue
      const token = m.person_id ? `P${m.person_id}` : m.role === 'suspect' ? 'an unlisted suspect' : 'an unlisted victim'
      if (m.person_id) this.people[token] = m.name
      this.add(m.name, token)
      if (m.alias && m.alias.length > 3) this.patterns.push({ re: new RegExp(`\\b${escapeRe(m.alias)}\\b`, 'gi'), token })
    }
  }

  mask(text: string): string {
    let out = text
    for (const { re, token } of this.patterns) out = out.replace(re, token)
    return out
  }
}

// ---------- Tools ----------
// db = caller's JWT (RLS); admin = service role, used only to read names for
// masking and structured people-as-tokens, never returned unmasked.
type Ctx = { db: SupabaseClient; admin: SupabaseClient; masker: Masker; canPersons: boolean }

async function peopleOn(ctx: Ctx, incidentIds: string[]) {
  // Structured suspects/victims as tokens (no raw names).
  const { data } = await ctx.admin
    .from('incident_persons')
    .select('incident_id, role, age, sex, status, placeholder, person_id')
    .in('incident_id', incidentIds)
  const byIncident: Record<string, unknown[]> = {}
  for (const m of data ?? []) {
    ;(byIncident[m.incident_id] ??= []).push({
      who: m.person_id ? `P${m.person_id}` : m.placeholder ? 'unidentified' : 'unlisted',
      role: m.role,
      age: m.age,
      sex: m.sex,
      status: m.status,
    })
  }
  return byIncident
}

function compactIncident(r: Record<string, unknown>, snippet = 300) {
  return {
    incident_id: r.id,
    blotter: r.blotterno,
    date: r.date_committed,
    time: r.time_committed,
    offense: offenseName(r.offense as string),
    type: r.incident_type,
    barangay: r.barangay,
    case_status: r.case_status,
    ...(r.similarity != null ? { similarity: Math.round((r.similarity as number) * 100) / 100 } : {}),
    ...(r.narrative ? { narrative: clip(r.narrative as string, snippet) } : {}),
  }
}

const TOOL_DEFS = [
  {
    name: 'search_incidents',
    description: 'Keyword search over incidents (blotter no., barangay, offense, type, names, narrative, status). Newest first.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for' },
        date_from: { type: 'string', description: 'YYYY-MM-DD, optional' },
        date_to: { type: 'string', description: 'YYYY-MM-DD, optional' },
        barangay: { type: 'string', description: 'Exact barangay name, optional' },
        limit: { type: 'integer', description: 'Max results (1-10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'semantic_search',
    description: 'Find incidents whose narrative is similar in meaning to a description (e.g. a modus operandi or suspect description).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Description to match' },
        category: { type: 'string', enum: ['crime', 'traffic'], description: 'Optional' },
        limit: { type: 'integer', description: 'Max results (1-8)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_incident',
    description: 'Full details of one incident: narrative, place, time, and the people named (as tokens with age/sex/status).',
    parameters: {
      type: 'object',
      properties: {
        incident_id: { type: 'string', description: 'Incident id (uuid)' },
        blotter: { type: 'string', description: 'Or a blotter number' },
      },
    },
  },
  {
    name: 'get_case',
    description: 'An investigation: title, summary, status, linked incidents and recent notes.',
    parameters: {
      type: 'object',
      properties: { investigation_id: { type: 'integer' } },
      required: ['investigation_id'],
    },
  },
  {
    name: 'similar_incidents',
    description: 'Incidents whose narratives read most like the given incident (other blotters only).',
    parameters: {
      type: 'object',
      properties: { incident_id: { type: 'string' } },
      required: ['incident_id'],
    },
  },
  {
    name: 'find_person',
    description: 'Look up people in the persons index by name. Returns tokens with how many blotters name them.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    personsOnly: true,
  },
  {
    name: 'get_person',
    description: 'All blotters a person token (e.g. P123) is named in, with role, offense, place, their status and age, plus people named alongside.',
    parameters: {
      type: 'object',
      properties: { person: { type: 'string', description: 'Token like P123' } },
      required: ['person'],
    },
    personsOnly: true,
  },
]

async function runTool(ctx: Ctx, name: string, args: Record<string, any>): Promise<unknown> {
  const { db, masker } = ctx
  switch (name) {
    case 'search_incidents': {
      const t = sanitize(String(args.query ?? ''))
      if (!t) return { error: 'query is required' }
      let q = db
        .from('incidents')
        .select(`${INCIDENT_COLS}, narrative`)
        .or(SEARCH_COLUMNS.map((c) => `${c}.ilike.*${t}*`).join(','))
        .order('date_committed', { ascending: false })
        .limit(Math.min(Math.max(Number(args.limit) || 6, 1), 10))
      if (args.date_from) q = q.gte('date_committed', args.date_from)
      if (args.date_to) q = q.lte('date_committed', args.date_to)
      if (args.barangay) q = q.eq('barangay', args.barangay)
      const { data, error } = await q
      if (error) return { error: error.message }
      await masker.load(data.map((r) => r.id))
      return data.map((r) => compactIncident(r))
    }
    case 'semantic_search': {
      const text = String(args.text ?? '').trim()
      if (!text) return { error: 'text is required' }
      const { data, error } = await db.rpc('match_incidents', {
        p_embedding: JSON.stringify(await embed(text)),
        p_limit: Math.min(Math.max(Number(args.limit) || 6, 1), 8),
        p_category: args.category ?? null,
        p_min_similarity: 0.5,
      })
      if (error) return { error: error.message }
      await masker.load((data ?? []).map((r: any) => r.id))
      return (data ?? []).map((r: any) => compactIncident(r))
    }
    case 'get_incident': {
      let q = db.from('incidents').select(`${INCIDENT_COLS}, narrative, case_solve_type`).limit(1)
      if (args.incident_id) q = q.eq('id', args.incident_id)
      else if (args.blotter) q = q.eq('blotterno', args.blotter)
      else return { error: 'incident_id or blotter is required' }
      const { data, error } = await q
      if (error) return { error: error.message }
      if (!data.length) return { error: 'not found' }
      const r = data[0]
      await masker.load([r.id])
      const people = await peopleOn(ctx, [r.id])
      return { ...compactIncident(r, 1500), street: r.street, place: r.type_of_place, modus: r.modus, solve_type: r.case_solve_type, people: people[r.id] ?? [] }
    }
    case 'get_case': {
      const { data, error } = await db
        .from('investigations')
        .select(`case_no, title, summary, status, priority,
                 links:investigation_incidents(incident:incidents(${INCIDENT_COLS})),
                 notes:investigation_notes(kind, body, created_at)`)
        .eq('id', args.investigation_id)
        .maybeSingle()
      if (error) return { error: error.message }
      if (!data) return { error: 'not found' }
      const incidents = (data.links ?? []).map((l: any) => l.incident).filter(Boolean)
      await masker.load(incidents.map((i: any) => i.id))
      const people = await peopleOn(ctx, incidents.map((i: any) => i.id))
      return {
        case_no: data.case_no,
        title: data.title,
        summary: data.summary,
        status: data.status,
        priority: data.priority,
        incidents: incidents.slice(0, 15).map((i: any) => ({ ...compactIncident(i), people: people[i.id] ?? [] })),
        recent_notes: (data.notes ?? [])
          .filter((n: any) => n.kind === 'note')
          .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
          .slice(0, 6)
          .map((n: any) => ({ date: n.created_at.slice(0, 10), note: clip(n.body, 300) })),
      }
    }
    case 'similar_incidents': {
      const { data, error } = await db.rpc('similar_incidents', { p_incident: args.incident_id, p_limit: 6 })
      if (error) return { error: error.message }
      await masker.load((data ?? []).map((r: any) => r.id))
      return (data ?? []).map((r: any) => compactIncident(r))
    }
    case 'find_person': {
      const { data, error } = await db.rpc('persons_search', { p_query: String(args.name ?? ''), p_limit: 5 })
      if (error) return { error: error.message }
      return (data ?? []).map((p: any) => {
        masker.people[`P${p.id}`] = p.display_name
        return {
          person: `P${p.id}`,
          match_score: p.score,
          blotters: p.blotters,
          as_suspect: p.as_suspect,
          as_victim: p.as_victim,
          born_est: p.birth_year_min ? `${p.birth_year_min}-${p.birth_year_max}` : null,
          last_suspect_status: p.last_suspect_status,
          barangays: (p.barangays ?? []).slice(0, 4),
        }
      })
    }
    case 'get_person': {
      const id = Number(String(args.person ?? '').replace(/^P/i, ''))
      if (!id) return { error: 'person token like P123 is required' }
      const { data, error } = await db.rpc('person_detail', { p_id: id })
      if (error) return { error: error.message }
      if (!data) return { error: 'not found' }
      masker.people[`P${id}`] = data.display_name
      const seen = new Set<string>()
      const blotters = []
      for (const m of data.mentions ?? []) {
        const k = `${m.blotterno}|${m.role}`
        if (seen.has(k)) continue
        seen.add(k)
        blotters.push({ blotter: m.blotterno, date: m.date_committed, role: m.role, offense: offenseName(m.offense), barangay: m.barangay, their_status: m.status, age_then: m.age, case_status: m.case_status })
      }
      return {
        person: `P${id}`,
        blotters: blotters.slice(0, 20),
        named_alongside: (data.associates ?? []).slice(0, 10).map((a: any) => ({ person: `P${a.id}`, roles: a.roles, shared_blotters: a.shared })),
      }
    }
  }
  return { error: `unknown tool ${name}` }
}

// ---------- Groq ----------
async function groq(model: string, messages: unknown[], tools: unknown[]) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 1024 }),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`Groq ${res.status}: ${text.slice(0, 300)}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return await res.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

  if (!Deno.env.get('GROQ_API_KEY')) return json({ error: 'GROQ_API_KEY is not set on the Edge Function' }, 500)

  const url = Deno.env.get('SUPABASE_URL')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: userData } = await db.auth.getUser(jwt)
  const user = userData?.user
  if (!user) return json({ error: 'Not signed in' }, 401)

  const [inv, per] = await Promise.all([
    db.rpc('can_access', { p_page: '/investigations' }),
    db.rpc('can_access', { p_page: '/persons' }),
  ])
  if (!inv.data) return json({ error: 'Your role does not include Investigations' }, 403)
  const canPersons = !!per.data

  const body = await req.json().catch(() => ({}))
  const question = String(body.question ?? '').trim()
  if (!question || question.length > 2000) return json({ error: 'Ask a question (up to 2000 characters)' }, 400)
  const investigationId = Number(body.investigationId) || null
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-6)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 1500) }))

  const masker = new Masker(admin)
  const ctx: Ctx = { db, admin, masker, canPersons }
  const toolDefs = TOOL_DEFS.filter((t) => canPersons || !t.personsOnly).map(({ personsOnly: _p, ...t }) => ({ type: 'function', function: t }))

  const context = investigationId
    ? `The investigator is viewing investigation id ${investigationId}. Call get_case first when the question is about "this case".`
    : 'The investigator is not viewing a specific case.'
  const messages: any[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${context}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
    ...history,
    { role: 'user', content: question },
  ]

  const toolLog: { name: string; args: unknown }[] = []
  let model = MODEL
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  let answer = ''
  let failure: string | null = null

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      let res
      try {
        res = await groq(model, messages, toolDefs)
      } catch (e: any) {
        // Free-tier rate limit on the big model: fall back to the small one once.
        if (e.status === 429 && model !== FALLBACK_MODEL) {
          model = FALLBACK_MODEL
          res = await groq(model, messages, toolDefs)
        } else throw e
      }
      usage.prompt_tokens += res.usage?.prompt_tokens ?? 0
      usage.completion_tokens += res.usage?.completion_tokens ?? 0
      const msg = res.choices?.[0]?.message
      if (!msg) throw new Error('Empty response from Groq')
      messages.push(msg)
      if (!msg.tool_calls?.length) {
        answer = msg.content ?? ''
        break
      }
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          args = {}
        }
        toolLog.push({ name: call.function.name, args })
        let result: unknown
        try {
          result = await runTool(ctx, call.function.name, args)
        } catch (e: any) {
          result = { error: e.message ?? String(e) }
        }
        let content = masker.mask(JSON.stringify(result))
        if (content.length > MAX_TOOL_CHARS) content = content.slice(0, MAX_TOOL_CHARS) + '…(truncated)'
        messages.push({ role: 'tool', tool_call_id: call.id, content })
      }
    }
    if (!answer) answer = 'I could not finish looking this up. Try a narrower question.'
  } catch (e: any) {
    failure = e.message ?? String(e)
  }

  await admin.from('ai_requests').insert({
    actor_id: user.id,
    investigation_id: investigationId,
    question,
    answer: answer || null,
    tools: toolLog,
    model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    error: failure,
  })

  if (failure) {
    const rateLimited = /Groq 429/.test(failure)
    return json(
      { error: rateLimited ? 'The free AI quota is used up for the moment. Try again in a minute.' : `AI request failed: ${failure}` },
      rateLimited ? 429 : 502
    )
  }

  return json({
    answer,
    model,
    tools: toolLog.map((t) => t.name),
    people: canPersons ? masker.people : {},
  })
})
