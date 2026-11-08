/**
 * Create (or update) a Crime Mapper user and assign their role. Server-side
 * only: uses the service_role key, like ingest.js. Use it to bootstrap the
 * first administrator; after that, admins manage users on the Admin page.
 *
 * Usage:
 *   bun scripts/create-user.js <email> <password> [role] [full name]
 *   bun scripts/create-user.js admin@example.com 'S3cure-pass' admin "PMaj Juan Dela Cruz"
 *
 *   role defaults to 'admin'; must be an id from the roles table
 *   (admin | investigator | analyst | officer | custom roles).
 *   If the email already exists, its password is reset and the role applied.
 *
 * Requires in .env: VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_KEY.
 * Never give the service key a VITE_ prefix or import it into the browser app.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const { SUPABASE_SERVICE_KEY } = process.env

const [email, password, role = 'admin', ...nameParts] = process.argv.slice(2)
const fullName = nameParts.join(' ').trim() || null

if (!email || !password) {
  console.error('Usage: bun scripts/create-user.js <email> <password> [role] [full name]')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(target) {
  const wanted = target.toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted)
    if (hit || data.users.length < 1000) return hit ?? null
  }
}

async function main() {
  const { data: roleRow, error: roleErr } = await supabase.from('roles').select('id, name').eq('id', role).maybeSingle()
  if (roleErr) throw roleErr
  if (!roleRow) throw new Error(`Unknown role "${role}". Run the auth_rbac migration, or pick an existing role id.`)

  let user = await findUserByEmail(email)
  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true })
    if (error) throw error
    console.log(`Existing user ${email}: password reset.`)
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    })
    if (error) throw error
    user = data.user
    console.log(`Created user ${email}.`)
  }

  // The on_auth_user_created trigger made the profile; set role (+ name).
  const patch = { role_id: roleRow.id, active: true }
  if (fullName) patch.full_name = fullName
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .upsert({ id: user.id, email, ...patch })
    .select('id')
  if (profErr) throw profErr
  if (!prof?.length) throw new Error('Profile was not written.')

  console.log(`Role: ${roleRow.name}. ${email} can now sign in.`)
}

main().catch((e) => {
  console.error('Failed:', e.message || e)
  process.exit(1)
})
