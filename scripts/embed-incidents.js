/**
 * Fill incidents.embedding by calling the embed-incidents Edge Function until
 * nothing is left. Server-side only (service key). ingest.js runs it after a
 * load; run it by hand after deploying the function the first time:
 *
 *   bun scripts/embed-incidents.js
 *
 * Requires: the similar_incidents_ai migration, the deployed function
 * (bunx supabase functions deploy embed-incidents), SUPABASE_SERVICE_KEY in .env.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

export async function embedIncidents(supabase, { batch = 5, log = console.log } = {}) {
  let size = batch
  let total = 0
  for (let round = 0; round < 2000; round++) {
    const { data, error } = await supabase.functions.invoke('embed-incidents', { body: { limit: size } })
    if (error) {
      // CPU/time limit on a large batch: retry smaller before giving up.
      if (size > 1) {
        size = Math.max(1, Math.floor(size / 2))
        log(`embed: call failed (${error.message}); retrying with batch ${size}`)
        continue
      }
      throw error
    }
    total += data.embedded
    if (round % 10 === 0 || !data.remaining) log(`embed: ${total} embedded, ${data.remaining} remaining`)
    if (!data.remaining || data.embedded === 0) break
  }
  return total
}

if (import.meta.main) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  embedIncidents(supabase).catch((e) => {
    console.error('Failed:', e.message || e)
    process.exit(1)
  })
}
