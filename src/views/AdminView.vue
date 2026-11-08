<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAdminStore, roleSlug } from '../stores/admin'
import { useAuthStore } from '../stores/auth'
import { APP_PAGES } from '../lib/pages'

const store = useAdminStore()
const auth = useAuthStore()
const { users, roles, loading, error } = storeToRefs(store)

const allowSignup = import.meta.env.VITE_ALLOW_SIGNUP === 'true'
const tab = ref('users')
const message = ref(null) // { type: 'error' | 'ok', text }
function flash(type, text) {
  message.value = { type, text }
  if (type === 'ok') setTimeout(() => message.value?.text === text && (message.value = null), 3000)
}

onMounted(store.fetchAll)

// ---------- Users ----------
const userFilter = ref('all') // all | pending | active | inactive
const userSearch = ref('')
const pendingCount = computed(() => users.value.filter((u) => !u.roleId).length)

const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  return users.value
    .filter((u) => {
      if (userFilter.value === 'pending' && u.roleId) return false
      if (userFilter.value === 'active' && !(u.roleId && u.active)) return false
      if (userFilter.value === 'inactive' && u.active) return false
      if (!q) return true
      return [u.fullName, u.email, u.rank, u.badgeNo].some((v) => v?.toLowerCase().includes(q))
    })
    .sort((a, b) => Number(!!a.roleId) - Number(!!b.roleId)) // awaiting approval first
})

const saving = reactive({})
async function saveUser(user, patch, okText) {
  saving[user.id] = true
  try {
    await store.updateUser(user.id, patch)
    if (okText) flash('ok', okText)
  } catch (e) {
    flash('error', e.message || String(e))
  } finally {
    saving[user.id] = false
  }
}

const label = (u) => u.fullName || u.email
const roleName = (id) => roles.value.find((r) => r.id === id)?.name ?? id

function onRoleChange(user, roleId) {
  saveUser(
    user,
    { roleId: roleId || null },
    roleId ? `${label(user)} is now ${roleName(roleId)}` : `${label(user)} set back to awaiting approval`
  )
}

function toggleActive(user) {
  const active = !user.active
  saveUser(user, { active }, `${label(user)} ${active ? 'reactivated' : 'deactivated'}`)
}

const editing = ref(null) // { id, fullName, rank, badgeNo }
function startEdit(user) {
  editing.value = { id: user.id, fullName: user.fullName || '', rank: user.rank || '', badgeNo: user.badgeNo || '' }
}
async function saveEdit(user) {
  const { fullName, rank, badgeNo } = editing.value
  await saveUser(user, { fullName: fullName.trim(), rank: rank.trim(), badgeNo: badgeNo.trim() }, 'Details saved')
  editing.value = null
}

const fmtDate = (s) => new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })

// ---------- Roles ----------
const userCount = (roleId) => users.value.filter((u) => u.roleId === roleId).length

async function togglePage(role, path) {
  const pages = role.pages.includes(path) ? role.pages.filter((p) => p !== path) : [...role.pages, path]
  try {
    await store.updateRole(role.id, { pages })
  } catch (e) {
    flash('error', e.message || String(e))
  }
}

async function removeRole(role) {
  if (!confirm(`Delete the role "${role.name}"?`)) return
  try {
    await store.deleteRole(role.id)
    flash('ok', `Role "${role.name}" deleted`)
  } catch (e) {
    flash('error', e.message || String(e))
  }
}

const newRole = reactive({ name: '', description: '', pages: ['/'] })
const newRoleSlug = computed(() => roleSlug(newRole.name))
const newRoleTaken = computed(() => roles.value.some((r) => r.id === newRoleSlug.value))
async function addRole() {
  try {
    await store.createRole({ ...newRole })
    flash('ok', `Role "${newRole.name.trim()}" created`)
    Object.assign(newRole, { name: '', description: '', pages: ['/'] })
  } catch (e) {
    flash('error', e.message || String(e))
  }
}
</script>

<template>
  <div class="admin">
    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="tab === 'users'" :class="{ active: tab === 'users' }" @click="tab = 'users'">
        Users
        <span v-if="pendingCount" class="count">{{ pendingCount }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'roles'" :class="{ active: tab === 'roles' }" @click="tab = 'roles'">
        Roles &amp; access
      </button>
    </div>

    <p v-if="error" class="banner error">⚠ {{ error }}</p>
    <p v-if="message" class="banner" :class="message.type" role="status">{{ message.text }}</p>
    <p v-if="loading && !users.length" class="muted">Loading…</p>

    <!-- USERS -->
    <section v-else-if="tab === 'users'" class="card">
      <div class="toolbar">
        <div class="segmented">
          <button
            v-for="f in [
              ['all', 'All'],
              ['pending', `Awaiting approval (${pendingCount})`],
              ['active', 'Active'],
              ['inactive', 'Deactivated'],
            ]"
            :key="f[0]"
            :class="{ active: userFilter === f[0] }"
            @click="userFilter = f[0]"
          >
            {{ f[1] }}
          </button>
        </div>
        <input v-model="userSearch" class="search" type="search" placeholder="Search name, email, rank, badge" />
      </div>

      <p class="hint">
        <template v-if="allowSignup">
          New users sign up with <strong>Request access</strong> on the sign-in page and appear here awaiting approval.
          Assign a role to let them in.
        </template>
        <template v-else>
          Self sign-up is turned off. Add people from the command line with
          <code>bun scripts/create-user.js &lt;email&gt; &lt;password&gt; &lt;role&gt; "Full Name"</code>.
        </template>
        Role changes take effect on the user's next page load.
      </p>

      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Rank</th>
            <th>Badge no.</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filteredUsers" :key="u.id" :class="{ pending: !u.roleId, inactive: !u.active }">
            <template v-if="editing?.id === u.id">
              <td>
                <input v-model="editing.fullName" class="cell-input" placeholder="Full name" />
                <span class="email">{{ u.email }}</span>
              </td>
              <td><input v-model="editing.rank" class="cell-input short" placeholder="e.g. PCpl" /></td>
              <td><input v-model="editing.badgeNo" class="cell-input short" placeholder="Badge" /></td>
              <td colspan="3" class="muted">Editing details…</td>
              <td class="actions">
                <button class="btn small primary" :disabled="saving[u.id]" @click="saveEdit(u)">Save</button>
                <button class="btn small" @click="editing = null">Cancel</button>
              </td>
            </template>
            <template v-else>
              <td>
                <span class="name">
                  {{ u.fullName || '—' }}
                  <span v-if="u.id === auth.user?.id" class="you">you</span>
                </span>
                <span class="email">{{ u.email }}</span>
              </td>
              <td>{{ u.rank || '—' }}</td>
              <td class="mono">{{ u.badgeNo || '—' }}</td>
              <td>
                <select
                  :value="u.roleId ?? ''"
                  :disabled="saving[u.id] || u.id === auth.user?.id"
                  :title="u.id === auth.user?.id ? 'You can’t change your own role' : ''"
                  @change="onRoleChange(u, $event.target.value)"
                >
                  <option value="">Awaiting approval</option>
                  <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
                </select>
              </td>
              <td>
                <button
                  class="status"
                  :class="u.active ? 'on' : 'off'"
                  :disabled="saving[u.id] || u.id === auth.user?.id"
                  :title="u.id === auth.user?.id ? 'You can’t deactivate yourself' : u.active ? 'Deactivate' : 'Reactivate'"
                  @click="toggleActive(u)"
                >
                  {{ u.active ? 'Active' : 'Deactivated' }}
                </button>
              </td>
              <td class="muted">{{ fmtDate(u.createdAt) }}</td>
              <td class="actions">
                <button class="btn small" @click="startEdit(u)">Edit</button>
              </td>
            </template>
          </tr>
          <tr v-if="!filteredUsers.length">
            <td colspan="7" class="muted empty">No users match.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ROLES -->
    <section v-else class="card">
      <p class="hint">
        Tick the pages each role may open. The sidebar, the page guard and the database's row-level security all use
        this list. The Administrator role always has every page.
      </p>

      <table class="matrix">
        <thead>
          <tr>
            <th>Role</th>
            <th v-for="p in APP_PAGES" :key="p.path" class="center">{{ p.name }}</th>
            <th class="center">Users</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in roles" :key="r.id">
            <td>
              <span class="name">
                {{ r.name }}
                <span v-if="r.id === 'admin'" class="tag">locked</span>
                <span v-else-if="r.isSystem" class="tag">system</span>
              </span>
              <span class="email">{{ r.description }}</span>
            </td>
            <td v-for="p in APP_PAGES" :key="p.path" class="center">
              <input
                type="checkbox"
                :checked="r.pages.includes(p.path)"
                :disabled="r.id === 'admin'"
                :aria-label="`${r.name}: ${p.name}`"
                @change="togglePage(r, p.path)"
              />
            </td>
            <td class="center mono">{{ userCount(r.id) }}</td>
            <td class="actions">
              <button
                v-if="!r.isSystem"
                class="btn small danger"
                :disabled="userCount(r.id) > 0"
                :title="userCount(r.id) ? 'Reassign its users first' : 'Delete role'"
                @click="removeRole(r)"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form class="new-role" @submit.prevent="addRole">
        <h3>New role</h3>
        <div class="new-role-fields">
          <label>
            <span>Name</span>
            <input v-model="newRole.name" required placeholder="e.g. Desk Officer" />
          </label>
          <label class="grow">
            <span>Description</span>
            <input v-model="newRole.description" placeholder="What this role is for" />
          </label>
        </div>
        <div class="page-checks">
          <label v-for="p in APP_PAGES" :key="p.path" class="check">
            <input v-model="newRole.pages" type="checkbox" :value="p.path" />
            {{ p.name }}
          </label>
        </div>
        <p v-if="newRole.name && (!newRoleSlug || newRoleTaken)" class="field-error">
          {{ newRoleTaken ? 'A role with this name already exists.' : 'Name must start with a letter.' }}
        </p>
        <button class="btn primary" type="submit" :disabled="!newRoleSlug || newRoleTaken || newRoleSlug.length < 2">
          Create role
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.tabs button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.tabs button.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.banner {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.banner.error {
  color: #f85149;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.35);
}

.banner.ok {
  color: var(--text);
  background: rgba(25, 158, 112, 0.12);
  border: 1px solid rgba(25, 158, 112, 0.4);
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  overflow-x: auto;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.segmented {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}

.segmented button {
  padding: 6px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.segmented button.active {
  background: var(--surface);
  color: var(--text);
}

.search {
  min-width: 260px;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.hint strong,
.hint code {
  color: var(--text);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: middle;
}

tr.pending td:first-child {
  box-shadow: inset 3px 0 0 var(--accent);
}

tr.inactive td {
  opacity: 0.6;
}

.center {
  text-align: center;
}

.name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.email {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
}

.you,
.tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.mono {
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--text-muted);
}

.empty {
  text-align: center;
  padding: 24px;
}

select,
.cell-input {
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.cell-input.short {
  width: 100px;
}

select:disabled {
  opacity: 0.6;
}

.status {
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.status.on {
  background: rgba(25, 158, 112, 0.15);
  color: #4cc59a;
}

.status.off {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
}

.status:disabled {
  cursor: default;
}

.actions {
  text-align: right;
  white-space: nowrap;
}

.btn {
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.btn.small {
  padding: 4px 10px;
  font-size: 12px;
}

.btn + .btn {
  margin-left: 6px;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.danger:hover:not(:disabled) {
  color: #f85149;
  border-color: #f85149;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.matrix input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.matrix input[type='checkbox']:disabled {
  cursor: default;
}

.new-role {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.new-role h3 {
  font-size: 14px;
  color: var(--text);
}

.new-role-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.new-role-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.new-role-fields .grow {
  flex: 1;
  min-width: 240px;
}

.new-role-fields input {
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.page-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.check input {
  accent-color: var(--accent);
}

.field-error {
  font-size: 12px;
  color: #f85149;
}
</style>
