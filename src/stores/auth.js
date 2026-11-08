import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '../lib/supabase'
import { APP_PAGES } from '../lib/pages'

// snake_case profile (with its role embedded) -> camelCase.
function mapProfile(p) {
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    rank: p.rank,
    badgeNo: p.badge_no,
    active: p.active,
    role: p.role ? { id: p.role.id, name: p.role.name, pages: p.role.pages || [] } : null,
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const profileError = ref(null)

  // Pages the signed-in user may open. Empty (no access) unless the profile is
  // active and has a role — the router guard fails closed on an empty list.
  const pages = computed(() =>
    profile.value?.active && profile.value.role ? profile.value.role.pages : []
  )
  const hasAccess = computed(() => pages.value.length > 0)
  const isAdmin = computed(() => pages.value.includes('/admin'))
  const canAccess = (path) => pages.value.includes(path)

  // First allowed page in sidebar order; where to land after sign-in.
  const homePath = computed(
    () => APP_PAGES.find((p) => pages.value.includes(p.path))?.path ?? '/pending'
  )

  const displayName = computed(() => {
    const p = profile.value
    if (!p) return user.value?.email ?? ''
    return [p.rank, p.fullName || p.email].filter(Boolean).join(' ')
  })
  const initials = computed(() => {
    const name = profile.value?.fullName || user.value?.email || '?'
    return name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('')
  })

  async function loadProfile() {
    profileError.value = null
    if (!user.value) {
      profile.value = null
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, rank, badge_no, active, role:roles(id, name, pages)')
      .eq('id', user.value.id)
      .maybeSingle()
    if (error) {
      // Fail closed: no profile means no pages.
      profile.value = null
      profileError.value = error.message
      return
    }
    profile.value = data ? mapProfile(data) : null
  }

  let initPromise = null
  // Resolve the stored session once; the router guard awaits this.
  function init() {
    if (!initPromise) {
      initPromise = (async () => {
        const { data } = await supabase.auth.getSession()
        user.value = data.session?.user ?? null
        await loadProfile()

        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            // Full reload clears every store's cached data.
            window.location.assign('/login')
            return
          }
          const changed = (session?.user?.id ?? null) !== (user.value?.id ?? null)
          user.value = session?.user ?? null
          // Don't await Supabase calls inside this callback (supabase-js can deadlock).
          if (changed) setTimeout(loadProfile, 0)
        })
      })()
    }
    return initPromise
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    user.value = data.user
    await loadProfile()
  }

  // Self-service access request: creates the account with no role. An admin
  // assigns one on the Admin page.
  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })
    if (error) throw error
    // With email confirmation on, there is no session until the link is clicked.
    if (data.session) {
      user.value = data.user
      await loadProfile()
    }
    return { needsConfirmation: !data.session }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return {
    user,
    profile,
    profileError,
    pages,
    hasAccess,
    isAdmin,
    canAccess,
    homePath,
    displayName,
    initials,
    init,
    loadProfile,
    signIn,
    signUp,
    signOut,
  }
})
