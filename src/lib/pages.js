// The app's permissionable pages: the route paths stored in roles.pages.
// Keep in sync with the roles.pages check constraint in
// supabase/migrations/20261103100000_auth_rbac.sql.
export const APP_PAGES = [
  { path: '/', name: 'Dashboard', icon: '◳' },
  { path: '/incidents', name: 'Incidents', icon: '◈' },
  { path: '/hotspot-map', name: 'Hotspot Map', icon: '◎' },
  { path: '/investigations', name: 'Investigations', icon: '⌕' },
  { path: '/persons', name: 'Persons', icon: '◐' },
  { path: '/admin', name: 'Admin', icon: '⚙' },
]
