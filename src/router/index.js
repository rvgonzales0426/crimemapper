import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

// Route components load on demand (keeps the sign-in page light).
const DashboardView = () => import('../views/DashboardView.vue')
const IncidentsView = () => import('../views/IncidentsView.vue')
const HotspotMapView = () => import('../views/HotspotMapView.vue')
const InvestigationsView = () => import('../views/InvestigationsView.vue')
const InvestigationDetailView = () => import('../views/InvestigationDetailView.vue')
const PersonsView = () => import('../views/PersonsView.vue')
const PersonDetailView = () => import('../views/PersonDetailView.vue')
const AdminView = () => import('../views/AdminView.vue')
const LandingView = () => import('../views/LandingView.vue')
const LoginView = () => import('../views/LoginView.vue')
const PendingView = () => import('../views/PendingView.vue')
const ForbiddenView = () => import('../views/ForbiddenView.vue')

// meta.page = the permission (a path in roles.pages) a route needs.
// meta.bare = render without the sidebar/topbar shell.
// meta.public = reachable signed out.
const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView,
    meta: { title: 'Dashboard', page: '/' },
  },
  {
    path: '/incidents',
    name: 'incidents',
    component: IncidentsView,
    meta: { title: 'Incidents', page: '/incidents' },
  },
  {
    path: '/hotspot-map',
    name: 'hotspot-map',
    component: HotspotMapView,
    meta: { title: 'Hotspot Map', page: '/hotspot-map' },
  },
  {
    path: '/investigations',
    name: 'investigations',
    component: InvestigationsView,
    meta: { title: 'Investigations', page: '/investigations' },
  },
  {
    path: '/investigations/:id(\\d+)',
    name: 'investigation',
    component: InvestigationDetailView,
    props: (route) => ({ id: Number(route.params.id) }),
    meta: { title: 'Investigation', page: '/investigations' },
  },
  {
    path: '/persons',
    name: 'persons',
    component: PersonsView,
    meta: { title: 'Persons', page: '/persons' },
  },
  {
    path: '/persons/:id(\\d+)',
    name: 'person',
    component: PersonDetailView,
    props: (route) => ({ id: Number(route.params.id) }),
    meta: { title: 'Person', page: '/persons' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView,
    meta: { title: 'Admin', page: '/admin' },
  },
  {
    path: '/welcome',
    name: 'landing',
    component: LandingView,
    meta: { title: 'Crime Mapper', public: true, bare: true },
  },
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { title: 'Sign in', public: true, bare: true },
  },
  {
    path: '/pending',
    name: 'pending',
    component: PendingView,
    meta: { title: 'Awaiting approval', bare: true },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: ForbiddenView,
    meta: { title: 'No access' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Fails closed: signed out -> /welcome (for "/") or /login; no active role -> /pending; a route
// whose page isn't in the user's role (or that declares no page) -> /forbidden.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()

  if (to.meta.public) {
    if (to.name === 'login' && auth.user) return auth.homePath
    return true
  }
  if (!auth.user) {
    // The bare address shows the front page; deep links go straight to sign-in.
    if (to.path === '/') return { name: 'landing' }
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'pending') return auth.hasAccess ? auth.homePath : true
  if (!auth.hasAccess) return { name: 'pending' }
  if (to.name === 'forbidden') return true

  if (to.meta.page && auth.canAccess(to.meta.page)) return true
  // Landing on "/" without Dashboard access isn't an error: go to the first allowed page.
  return to.path === '/' ? auth.homePath : { name: 'forbidden' }
})

export default router
