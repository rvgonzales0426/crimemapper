import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { mapRow, sanitizeSearch, SEARCH_COLUMNS } from './incidents'

export const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'closed', label: 'Closed' },
]
export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

// "PCpl Juan Dela Cruz" (falls back to the email).
export function personLabel(p) {
  if (!p) return null
  return [p.rank, p.full_name || p.fullName || p.email].filter(Boolean).join(' ')
}

const PERSON = 'id, full_name, rank, email'
const INCIDENT_COLS =
  'id, blotterno, date_committed, time_committed, barangay, street, offense, incident_type, case_status, lat, lng, coord_flag'

function mapCase(r) {
  return {
    id: r.id,
    caseNo: r.case_no,
    title: r.title,
    summary: r.summary,
    status: r.status,
    priority: r.priority,
    leadId: r.lead_id,
    lead: personLabel(r.lead),
    createdBy: r.created_by,
    creator: personLabel(r.creator),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
    incidentCount: r.investigation_incidents?.[0]?.count ?? null,
    noteCount: r.investigation_notes?.[0]?.count ?? null,
    incidents: (r.links || [])
      .filter((l) => l.incident)
      .map((l) => ({ ...mapRow(l.incident), addedAt: l.added_at }))
      .sort((a, b) => (b.dateCommitted || '').localeCompare(a.dateCommitted || '')),
    notes: (r.notes || [])
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        createdAt: n.created_at,
        authorId: n.author_id,
        author: personLabel(n.author),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id),
  }
}

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

export const useInvestigationsStore = defineStore('investigations', () => {
  // --- List ---
  const list = ref([])
  const listLoading = ref(false)
  const listError = ref(null)
  const listFilters = ref({ status: '', search: '' })

  let listRequest = 0
  async function fetchList() {
    const id = ++listRequest
    listLoading.value = true
    listError.value = null
    try {
      let q = supabase
        .from('investigations')
        .select(
          `id, case_no, title, status, priority, lead_id, created_at, updated_at, closed_at,
           lead:profiles!investigations_lead_id_fkey(${PERSON}),
           investigation_incidents(count), investigation_notes(count)`
        )
        .eq('investigation_notes.kind', 'note')
        .order('updated_at', { ascending: false })
      const f = listFilters.value
      if (f.status) q = q.eq('status', f.status)
      const term = sanitizeSearch(f.search)
      if (term) q = q.or(`title.ilike.*${term}*,case_no.ilike.*${term}*,summary.ilike.*${term}*`)
      const data = await must(q)
      if (id === listRequest) list.value = data.map(mapCase)
    } catch (e) {
      if (id === listRequest) listError.value = e.message || String(e)
    } finally {
      if (id === listRequest) listLoading.value = false
    }
  }

  function setListFilters(patch) {
    listFilters.value = { ...listFilters.value, ...patch }
    fetchList()
  }

  // --- One case ---
  const current = ref(null)
  const currentLoading = ref(false)
  const currentError = ref(null)

  async function fetchOne(id) {
    currentLoading.value = true
    currentError.value = null
    try {
      const data = await must(
        supabase
          .from('investigations')
          .select(
            `id, case_no, title, summary, status, priority, lead_id, created_by, created_at, updated_at, closed_at,
             lead:profiles!investigations_lead_id_fkey(${PERSON}),
             creator:profiles!investigations_created_by_fkey(${PERSON}),
             links:investigation_incidents(added_at, incident:incidents(${INCIDENT_COLS})),
             notes:investigation_notes(id, kind, body, created_at, author_id, author:profiles(${PERSON}))`
          )
          .eq('id', id)
          .maybeSingle()
      )
      if (!data) throw new Error('Investigation not found')
      current.value = mapCase(data)
    } catch (e) {
      current.value = null
      currentError.value = e.message || String(e)
    } finally {
      currentLoading.value = false
    }
  }

  const refresh = () => current.value && fetchOne(current.value.id)

  async function create({ title, summary, priority, leadId }) {
    const data = await must(
      supabase
        .from('investigations')
        .insert({ title: title.trim(), summary: summary?.trim() || null, priority, lead_id: leadId || null })
        .select('id')
        .single()
    )
    return data.id
  }

  // patch: any of { title, summary, status, priority, leadId }
  async function update(id, patch) {
    const row = {}
    if ('title' in patch) row.title = patch.title.trim()
    if ('summary' in patch) row.summary = patch.summary?.trim() || null
    if ('status' in patch) row.status = patch.status
    if ('priority' in patch) row.priority = patch.priority
    if ('leadId' in patch) row.lead_id = patch.leadId || null
    const data = await must(supabase.from('investigations').update(row).eq('id', id).select('id'))
    if (!data.length) throw new Error('Not saved (no permission?)')
    await refresh()
  }

  async function remove(id) {
    const data = await must(supabase.from('investigations').delete().eq('id', id).select('id'))
    if (!data.length) throw new Error('Only the creator of a case or an administrator can delete it')
    current.value = null
    list.value = list.value.filter((c) => c.id !== id)
  }

  async function linkIncidents(id, incidentIds) {
    await must(
      supabase.from('investigation_incidents').upsert(
        incidentIds.map((incidentId) => ({ investigation_id: id, incident_id: incidentId })),
        { onConflict: 'investigation_id,incident_id', ignoreDuplicates: true }
      )
    )
    if (current.value?.id === id) await refresh()
  }

  async function unlinkIncident(id, incidentId) {
    await must(
      supabase.from('investigation_incidents').delete().eq('investigation_id', id).eq('incident_id', incidentId)
    )
    if (current.value?.id === id) await refresh()
  }

  async function addNote(id, body) {
    await must(supabase.from('investigation_notes').insert({ investigation_id: id, body: body.trim() }))
    await refresh()
  }

  async function deleteNote(noteId) {
    const data = await must(supabase.from('investigation_notes').delete().eq('id', noteId).select('id'))
    if (!data.length) throw new Error('You can only delete your own notes')
    await refresh()
  }

  // --- Lookups ---
  // Officers who can work cases (lead investigator choices).
  async function fetchOfficers() {
    const data = await must(
      supabase.from('profiles').select(`${PERSON}, active, role:roles(pages)`).eq('active', true).order('full_name')
    )
    return data
      .filter((p) => p.role?.pages?.includes('/investigations'))
      .map((p) => ({ id: p.id, label: personLabel(p) }))
  }

  async function searchIncidents(term, limit = 25) {
    const t = sanitizeSearch(term)
    if (!t) return []
    const data = await must(
      supabase
        .from('incidents')
        .select(INCIDENT_COLS)
        .or(SEARCH_COLUMNS.map((c) => `${c}.ilike.*${t}*`).join(','))
        .order('date_committed', { ascending: false })
        .order('id')
        .limit(limit)
    )
    return data.map(mapRow)
  }

  // Cases an incident is linked to.
  async function casesForIncident(incidentId) {
    const data = await must(
      supabase
        .from('investigation_incidents')
        .select('investigation:investigations(id, case_no, title, status)')
        .eq('incident_id', incidentId)
    )
    return data
      .map((r) => r.investigation)
      .filter(Boolean)
      .map((c) => ({ id: c.id, caseNo: c.case_no, title: c.title, status: c.status }))
  }

  // Cases still being worked (for "Add to investigation").
  async function openCases() {
    const data = await must(
      supabase
        .from('investigations')
        .select('id, case_no, title, status')
        .neq('status', 'closed')
        .order('updated_at', { ascending: false })
    )
    return data.map((c) => ({ id: c.id, caseNo: c.case_no, title: c.title, status: c.status }))
  }

  return {
    list,
    listLoading,
    listError,
    listFilters,
    fetchList,
    setListFilters,
    current,
    currentLoading,
    currentError,
    fetchOne,
    create,
    update,
    remove,
    linkIncidents,
    unlinkIncident,
    addNote,
    deleteNote,
    fetchOfficers,
    searchIncidents,
    casesForIncident,
    openCases,
  }
})
