// Edge Function: embed incident narratives with Supabase's built-in gte-small
// model (384 dims, free, runs inside Supabase so the text never leaves it).
//
// Service-role only: called by scripts/embed-incidents.js (and ingest.js),
// never by the browser. Each call embeds up to `limit` incidents that have no
// embedding yet and returns how many remain, so the caller just loops.
// Kept small per call: Edge Functions have a per-request CPU budget.
import { createClient } from 'npm:@supabase/supabase-js@2'

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<number[]> } }
}

const model = new Supabase.ai.Session('gte-small')
const MAX_CHARS = 2000 // gte-small reads ~512 tokens; the rest would be ignored anyway

// The gateway has already verified the JWT signature (verify_jwt = true);
// only the service role may run this.
function isServiceRole(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function incidentText(r: { offense: string | null; modus: string | null; narrative: string | null }): string {
  const offense = (r.offense ?? '').split(' - ')[0].trim()
  return [offense, r.modus, r.narrative].filter(Boolean).join('. ').replace(/\s+/g, ' ').slice(0, MAX_CHARS)
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response('Forbidden', { status: 403 })

  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 25)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: rows, error } = await supabase
    .from('incidents')
    .select('id, offense, modus, narrative')
    .is('embedding', null)
    .order('id')
    .limit(limit)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let embedded = 0
  for (const r of rows ?? []) {
    const text = incidentText(r)
    if (!text) continue
    const vector = await model.run(text, { mean_pool: true, normalize: true })
    const { error: upErr } = await supabase
      .from('incidents')
      .update({ embedding: JSON.stringify(vector) })
      .eq('id', r.id)
    if (upErr) return Response.json({ error: upErr.message, embedded }, { status: 500 })
    embedded++
  }

  const { count } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)
    .not('narrative', 'is', null)

  return Response.json({ embedded, remaining: count ?? null })
})
