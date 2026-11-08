import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

function mapUser(p) {
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    rank: p.rank,
    badgeNo: p.badge_no,
    roleId: p.role_id,
    active: p.active,
    createdAt: p.created_at,
  }
}

function mapRole(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    pages: r.pages || [],
    isSystem: r.is_system,
  }
}

// "Crime Analyst II" -> "crime-analyst-ii" (roles.id format).
export function roleSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
}

// Writes are enforced server-side: admin_update_user() checks the caller is an
// admin and that an active admin remains; roles writes go through RLS + the
// protect_roles trigger. The UI checks are only for convenience.
export const useAdminStore = defineStore('admin', () => {
  const users = ref([])
  const roles = ref([])
  const loading = ref(false)
  const error = ref(null)

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      const [u, r] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, rank, badge_no, role_id, active, created_at')
          .order('created_at', { ascending: true }),
        supabase.from('roles').select('id, name, description, pages, is_system').order('created_at'),
      ])
      if (u.error) throw u.error
      if (r.error) throw r.error
      users.value = u.data.map(mapUser)
      roles.value = r.data.map(mapRole)
    } catch (e) {
      error.value = e.message || String(e)
    } finally {
      loading.value = false
    }
  }

  // patch: { roleId?, active?, fullName?, rank?, badgeNo? }
  async function updateUser(id, patch) {
    const current = users.value.find((u) => u.id === id)
    const next = { ...current, ...patch }
    const { error: err } = await supabase.rpc('admin_update_user', {
      p_user: id,
      p_role: next.roleId || null,
      p_active: next.active,
      p_full_name: next.fullName || null,
      p_rank: next.rank || null,
      p_badge_no: next.badgeNo || null,
    })
    if (err) throw err
    Object.assign(current, patch)
  }

  async function createRole({ name, description, pages }) {
    const { data, error: err } = await supabase
      .from('roles')
      .insert({ id: roleSlug(name), name: name.trim(), description: description?.trim() || null, pages })
      .select('id, name, description, pages, is_system')
      .single()
    if (err) throw err
    roles.value.push(mapRole(data))
  }

  async function updateRole(id, patch) {
    const row = {}
    if ('name' in patch) row.name = patch.name
    if ('description' in patch) row.description = patch.description
    if ('pages' in patch) row.pages = patch.pages
    const { data, error: err } = await supabase
      .from('roles')
      .update(row)
      .eq('id', id)
      .select('id, name, description, pages, is_system')
    if (err) throw err
    if (!data.length) throw new Error('Role was not updated (no permission?)')
    Object.assign(
      roles.value.find((r) => r.id === id),
      mapRole(data[0])
    )
  }

  async function deleteRole(id) {
    const { data, error: err } = await supabase.from('roles').delete().eq('id', id).select('id')
    if (err) throw err
    if (!data.length) throw new Error('Role was not deleted (no permission?)')
    roles.value = roles.value.filter((r) => r.id !== id)
  }

  return { users, roles, loading, error, fetchAll, updateUser, createRole, updateRole, deleteRole }
})
