# Crime Mapper

Crime Mapper is an AI-assisted geospatial crime analysis dashboard for **PNP Butuan City Police Station 4**. It helps officers visualize, query, and analyze crime incidents on an interactive map, with AI-assisted insights surfaced directly in the dashboard.

## Stack

- **Vue 3** — UI framework (Composition API, `<script setup>`).
- **Vite** — build tool and dev server.
- **Vue Router** — client-side routing.
- **Pinia** — state management.
- **Leaflet.js** — interactive maps and geospatial visualization.
- **Supabase** — backend: PostgreSQL with **PostGIS** (spatial queries) and **pgvector** (embeddings / semantic search).
- **Groq** (`openai/gpt-oss-120b`, free tier) — hosted open-weight LLM for the case assistant, called only from the `case-assistant` Supabase Edge Function (key = Edge Function secret `GROQ_API_KEY`). Falls back to `openai/gpt-oss-20b` on a rate limit. (Groq retired the Llama 3.x models on the free tier on 2026-08-16; override with `GROQ_MODEL` / `GROQ_FALLBACK_MODEL`.)
- **Supabase `gte-small`** — built-in embedding model (384 dims) inside Edge Functions; narrative text never leaves Supabase.
- **axios** — HTTP client.
- **Bun** — package manager and script runner (`bun install`, `bun run dev`, `bun ingest.js`). Lockfile is `bun.lock`; don't add a `package-lock.json`.

## Styling

Do **not** add any UI component library. All styling is **custom CSS**.

- Theme tokens (dark scheme) live as CSS variables in [src/style.css](src/style.css): `--bg #0d1117`, `--sidebar #161b22`, `--surface #1c2230`, `--border #2a3140`, `--accent #e85d04` (orange), `--text`, `--text-muted`, plus `--sidebar-width: 240px` and `--topbar-height: 60px`.
- Font is **Inter**, loaded via Google Fonts in [index.html](index.html). The landing page also uses **Barlow Condensed** (display) and **IBM Plex Mono** (labels/figures), loaded in the same link; keep them to that page.
- Component styles are `<style scoped>`. Styles that target Leaflet-rendered DOM (popups) live in an unscoped `<style>` block in the same component.

## Conventions

- Use Vue 3 Composition API with `<script setup>`.
- Keep all styling custom; no component libraries.
- DB columns are `snake_case`; the app uses `camelCase`. Map between them in the store (see `mapRow` in the incidents store) — views and components only ever see `camelCase`.
- Spatial queries go through Supabase/PostGIS; semantic search through pgvector. Exception: Monte Carlo statistics too heavy for the API timeout (Knox) run in a Web Worker on points PostGIS has already filtered and projected.
- AI runs only in Supabase Edge Functions (`supabase/functions/`): never call an LLM or hold an AI key in the browser. Edge Functions act as the caller (their JWT) so RLS applies; the service role is used only for masking and audit writes. Names from records are masked to `P<person id>` tokens before text leaves Supabase.
- Imports use relative paths (no `@` alias is configured).

## Project Structure

```
src/
  assets/         # Static assets (images)
  components/     # Reusable UI components
    AppSidebar.vue      # Fixed 240px left nav: brand + RouterLinks + station footer
    AppTopbar.vue       # Top bar: page title (route meta) + signed-in user, role, Sign out
    PlaceholderView.vue # Shared "coming soon" card (currently unused; for future stub views)
    CaseBadge.vue       # Investigation status / priority pill (always labelled)
    CaseMap.vue         # Small Leaflet map of a case's linked incidents
    IncidentCases.vue   # Incident detail panel section: linked cases, add to case, start case
    IncidentPersons.vue # Incident detail panel section: parsed suspects/victims, linked to Persons
    SimilarIncidents.vue # Incident detail panel section: nearest narratives (similar_incidents RPC)
    PersonMatchCard.vue # A suggested same-person pair with evidence + Same person / Not the same
    AssistantPanel.vue  # "Ask AI" chat (case-assistant Edge Function); P-tokens and [blotter] cites render as links
    KnoxPanel.vue       # Map overlay: Knox settings, one-line finding, ratio table (significant cells tinted)
    PatrolPanel.vue     # Map overlay: patrol-zone settings + ranked zone list (click -> `focus`)
    charts/             # Hand-built SVG/CSS charts (no chart library), all with hover/focus tooltips
      ChartTooltip.vue  # Fixed-position readout shared by the charts
      StatTile.vue      # KPI tile: label, value, signed delta (arrow + colour), hint
      BarList.vue       # Ranked horizontal bars, value at tip, optional click -> `select`
      ColumnChart.vue   # Single-series columns (months), ResizeObserver-measured SVG
      HourHeatmap.vue   # Day-of-week x hour grid, sequential blue ramp
      StackedBar.vue    # Part-to-whole single bar + legend with values
  composables/
    useSupabase.js      # useSupabase() -> { supabase } accessor
  lib/
    pages.js            # APP_PAGES: the permissionable route paths (sidebar order, names, icons)
    supabase.js         # Shared Supabase client singleton (anon key)
    knox.js             # Pure Knox test (knoxTest(points, options)); runs under Bun for tests
  workers/
    knox.worker.js      # Web Worker wrapper around lib/knox.js
  router/
    index.js            # Route table (see Routes)
  stores/
    incidents.js        # Pinia store for incidents (see Stores)
    dashboard.js        # Pinia store for Dashboard aggregates (see Stores)
    knox.js             # Pinia store for the Knox near-repeat test (see Stores)
    patrol.js           # Pinia store for priority patrol zones + patrolWindow() helper (see Stores)
    auth.js             # Session, profile + role, canAccess(path), sign in/up/out (see Stores)
    admin.js            # Users + roles management for the Admin page (see Stores)
    investigations.js   # Case list, current case, links, notes, lookups (see Stores)
    persons.js          # Persons index search, person detail, match suggestions, merge/split (see Stores)
    assistant.js        # case-assistant conversations, one thread per case (see Stores)
  views/                # Route-level pages
    DashboardView.vue       # KPIs (CCE/CSE), monthly trend, case status, top barangays/offenses, day x hour heatmap
    IncidentsView.vue       # Searchable/filterable table + slide-in detail panel
    HotspotMapView.vue      # Leaflet map: incident points, PostGIS KDE heatmap (canvas), Knox near-repeat clusters, priority patrol zones; Patrol/Knox panels stack bottom-left in `.analysis-panels`
    InvestigationsView.vue  # Case list: status filter, search, new-case form
    InvestigationDetailView.vue # One case: status/priority/lead, summary, linked incidents (+map, search to link), notes + audit timeline
    PersonsView.vue         # Persons index (search, suspect/victim filter, repeat-only) + Possible matches queue
    PersonDetailView.vue    # One person: blotters (role, status, age then), map, named alongside, cases, possible matches, Split
    AdminView.vue           # Users (approve, role, deactivate, edit details) + Roles & access (role x page matrix, custom roles)
    LandingView.vue         # Public front page (bare): duty strip with Manila time, illustrative patrol map, tools as blotter-book entries, route map, data-rules memorandum. Paper/ink palette plus Philippine flag colours (blue #0038A8, red #CE1126, sun gold #FCD116 used only on blue), eight-rayed sun mark, flag ribbon rule, a Filipino line; all scoped to the view. Shows no real data (illustrative map, no hotspots/patrol windows/names)
    LoginView.vue           # Sign in (+ Request access when VITE_ALLOW_SIGNUP=true) (bare layout)
    PendingView.vue         # Signed in but no role / deactivated (bare layout)
    ForbiddenView.vue       # Route outside the user's role
  App.vue           # Shell layout: <AppSidebar> + (<AppTopbar> + <RouterView>); routes with meta.bare render alone
  main.js           # Creates app, installs Pinia + Router, mounts after the first navigation resolves
  style.css         # Global theme tokens + base styles
scripts/            # Server-side only (service key from .env), like ingest.js
  create-user.js    # Create/update a user and set their role; bootstraps the first admin
  build-persons.js  # Parse suspect_raw/victim_raw into the persons index (incremental; ingest.js runs it)
  embed-incidents.js # Drive the embed-incidents Edge Function until every narrative is embedded (ingest.js runs it)
  lib/persons.js    # Pure parser: splitTopLevel, parsePersons, normalizeName, isPlaceholder
supabase/
  config.toml       # Minimal CLI config (verify_jwt for both functions)
  migrations/       # See Migrations
  functions/
    embed-incidents/ # gte-small embeddings for incidents.embedding (service role only)
    case-assistant/  # Groq tool-calling assistant (signed-in /investigations users)
```

App layout: a fixed 240px sidebar with the main content area offset by `--sidebar-width`. The content area has 24px padding; `HotspotMapView` deliberately cancels that padding with negative margins to render the map full-bleed.

## Components

- **AppSidebar.vue** — Fixed left sidebar. Brand "CRIME MAPPER" at top, `RouterLink` nav to the `APP_PAGES` the user's role allows (active link highlighted in accent orange), station footer. Nav icons are inline Unicode glyphs (no icon dependency).
- **AppTopbar.vue** — Current page title from `route.meta.title`; the signed-in user (`rank full name`), role name, initials avatar and a Sign out button.
- **PlaceholderView.vue** — Props `title` / `description`; renders a centered "coming soon" card. Not used by any route at the moment.
- **charts/** — Follow the dataviz rules: one hue per single series (blue `#3987e5`), sequential = single-hue ramp, colours follow the entity not its rank, 2px gaps between touching marks, 4px rounded data-ends, text in text tokens (never the series colour), every mark has a hover + keyboard-focus tooltip. Case-status colours: Solved `#3987e5`, Cleared `#199e70`, Under Investigation `#d95926` (validated on `--surface`). The orange `--accent` is for UI chrome, not data.

## Routes

Defined in [src/router/index.js](src/router/index.js) (history mode, `createWebHistory`; views are lazy-loaded). Each route carries `meta.title` (for `AppTopbar`) and `meta.page`, the `roles.pages` entry it needs. `meta.public` = reachable signed out; `meta.bare` = no sidebar/topbar.

| Path             | Name              | Component             | meta.title      |
| ---------------- | ----------------- | --------------------- | --------------- |
| `/`              | `dashboard`       | `DashboardView`       | Dashboard       |
| `/incidents`     | `incidents`       | `IncidentsView`       | Incidents       |
| `/hotspot-map`   | `hotspot-map`     | `HotspotMapView`      | Hotspot Map     |
| `/investigations`| `investigations`  | `InvestigationsView`  | Investigations  |
| `/investigations/:id` | `investigation` | `InvestigationDetailView` (prop `id`) | Investigation (page `/investigations`) |
| `/persons`       | `persons`         | `PersonsView`         | Persons         |
| `/persons/:id`   | `person`          | `PersonDetailView` (prop `id`) | Person (page `/persons`) |
| `/admin`         | `admin`           | `AdminView`           | Admin           |
| `/welcome`       | `landing`         | `LandingView`         | Crime Mapper (public, bare) |
| `/login`         | `login`           | `LoginView`           | Sign in (public, bare) |
| `/pending`       | `pending`         | `PendingView`         | Awaiting approval (bare) |
| `/forbidden`     | `forbidden`       | `ForbiddenView`       | No access       |

Unknown paths redirect to `/`. **Guard (`router.beforeEach`) fails closed:** awaits `auth.init()`; signed out → `/welcome` for the bare `/`, otherwise `/login?redirect=…` (LoginView only follows same-app paths); no active role → `/pending`; a route whose `meta.page` isn't in the role's pages (or that has no `meta.page`) → `/forbidden`, except `/`, which goes to the user's first allowed page (`auth.homePath`).

## Stores

### `useIncidentsStore` — [src/stores/incidents.js](src/stores/incidents.js)

Setup-style Pinia store. Reads from the Supabase `incidents` table and exposes two independently-fetched datasets plus shared filters.

**Table (paginated) state:** `incidents`, `loading`, `error`, `page`, `pageSize` (50), `totalCount`, `totalPages`.

**Filter state (shared by table + map):** `filters` = `{ search, dateFrom, dateTo, barangay, offense, caseStatus }`, and `filterOptions` = `{ barangays, offenses, caseStatuses }`.

**Map state:** `mapIncidents` (up to 5000 points, respecting filters), `mapLoading`, `mapError` (separate from the table's `error`), `kdeCells` (KDE grid cells `{ south, west, north, east, density, weight }`), `kdeLoading`.

**Actions:**

- `fetchIncidents()` — paginated table query (`.range()` + `count: 'exact'`), ordered by `date_committed` desc.
- `fetchMapIncidents()` — coordinates + key fields for the map; filtered, excludes null coords and any row with a `coord_flag` (missing / stacked default pin).
- `fetchKde({ bandwidthM = 400, cellM = 150 })` — calls the `incidents_kde_grid` RPC with the current filters; fills `kdeCells`.
- `fetchFilterOptions()` — distinct `barangay` / `offense` / `case_status` values for the dropdowns, scanned across every row.
- `setPage(p)` / `nextPage()` / `prevPage()` — pagination; refetch the table.
- `applyFilters(patch)` — merge a filter patch, reset to page 1, refetch the table.
- `resetFilters()` — clear all filters, reset to page 1, refetch.

**Notes:** Filtering and search are **server-side** (so they apply across the whole dataset, not just the current page). Search uses `.or(...ilike...)` across the text columns; the term is sanitized to avoid breaking PostgREST `.or()` syntax. The table and map fetch independently — the map fetches on mount and refetches whenever the shared filters change. `mapRow` converts every DB column to camelCase and coerces `lat`/`lng` to numbers.

### `useDashboardStore` — [src/stores/dashboard.js](src/stores/dashboard.js)

State: `stats` (camelCased result of the `incidents_dashboard` RPC), `loading`, `error`, `period` (`'all'` or a year), `category` (`''` | `'crime'` | `'traffic'`), computed `dateRange` and `years` (from the data's extent). Actions: `fetchDashboard()` (drops out-of-order responses), `setPeriod(p)`, `setCategory(c)`. Independent of the incidents filters; clicking a barangay/offense bar calls `incidentsStore.applyFilters(...)` with the period's date range and routes to `/incidents`.

**Data facts the dashboard relies on:** `case_status` is one of `Solved` / `Cleared` / `Under Investigation`. PNP efficiency: **CCE** = (Cleared + Solved) / total, **CSE** = Solved / total (a solved case is also cleared). ~63% of rows are traffic (`incident_type` "(Incident) Vehicular Accident") — the `category` filter separates them from crimes.

### `useKnoxStore` — [src/stores/knox.js](src/stores/knox.js)

State: `settings` `{ spatialBand (m), temporalBand (days), iterations, includeTraffic }`, `points` (camelCased analysis points, index-aligned with the result), `result`, `loading`, `error`. `run()` calls `incidents_analysis_points` with the **shared incidents filters** (+ `p_category: 'crime'` unless `includeTraffic`), then posts `{x, y, day}` to the worker; stale responses are dropped. `updateSettings(patch)` merges and reruns. The map runs it only while the Knox layer is on (stale-flag pattern, same as KDE).

**Knox method** ([src/lib/knox.js](src/lib/knox.js)) — Ratcliffe Near Repeat Calculator: rows = same location (< 1 m), `spatialBands` (5) bands of `spatialBand`, beyond; columns = `temporalBands` (5) bands of `temporalBand` days (0–t, t+1–2t, …), beyond. Ratio = observed ÷ mean of `iterations` date-permutations; one-sided p = (1 + #perm ≥ obs) / (iterations + 1); seeded PRNG so results are reproducible. The beyond row is computed as column totals minus the rest (the all-pairs time distribution is permutation-invariant). UI highlights only cells with p ≤ 0.05 **and** ratio ≥ 1.2 (NRC convention), never the beyond row/column. Map clusters = union-find over real-date pairs within `spatialBand` m and `temporalBand` days. Verified: null data → ~5% false positives; planted repeats → ratio 10.3 in the right cell; real data (crimes, 100 m / 7 d) → significant at 1–100 m for 0–14 days. Runs in 30–150 ms for ~1,300 points.

### `usePatrolStore` — [src/stores/patrol.js](src/stores/patrol.js)

State: `settings` `{ sd (hotspot cut-off = mean + sd·SD of KDE cell densities; 1/2/3 = broad/standard/tight, default 2), category ('crime' default | 'traffic' | '') }`, `zones`, `loading`, `error`. `run()` calls `incidents_patrol_zones` with the shared incidents filters; `updateSettings(patch)` merges and reruns. Each zone is mapped to `{ rank, zid, geojson, areaKm2, threshold, peakDensity, incidents, total, share, topOffenses, barangays, window }` where `window = patrolWindow(byHour, byDow)` → busiest 3-hour block (wraps midnight; `time: null` when no recorded times), its share of timed incidents, and the two busiest days. The map runs it only while the Patrol layer is on; selecting a zone restyles layers in place (never rebuilds, so the popup stays open) and `fitBounds` to it. Zones draw in their own `patrol` pane (z-index 450, above the incident points) with `pointer-events: visibleStroke`, so points inside a zone stay clickable; the rank badge (interactive tooltip) opens the zone popup. When new zones arrive and aren't all visible, the map fits them, padded clear of the layer control and the analysis panels (`fitOptions`).

### `useAuthStore` — [src/stores/auth.js](src/stores/auth.js)

State: `user` (Supabase auth user), `profile` (`{ id, email, fullName, rank, badgeNo, active, role: { id, name, pages } | null }`), `profileError`. Computed: `pages` (the role's pages only if the profile is active and has a role, else `[]`), `hasAccess`, `isAdmin` (= has `/admin`), `homePath`, `displayName`, `initials`; `canAccess(path)`. Actions: `init()` (once; restores the session, loads the profile, subscribes to `onAuthStateChange`: `SIGNED_OUT` does a full reload to `/login` so no store keeps another user's data; profile reloads are deferred with `setTimeout` because awaiting Supabase inside that callback can deadlock), `loadProfile()`, `signIn`, `signUp(email, password, fullName)` (self-service "Request access"; returns `{ needsConfirmation }`), `signOut`. Role changes reach a user on their next page load (or "Check again" on `/pending`); RLS applies them immediately server-side.

### `useAdminStore` — [src/stores/admin.js](src/stores/admin.js)

`users`, `roles`, `loading`, `error`; `fetchAll()`, `updateUser(id, { roleId, active, fullName, rank, badgeNo })` (→ `admin_update_user` RPC), `createRole({ name, description, pages })` (id = `roleSlug(name)`), `updateRole(id, patch)`, `deleteRole(id)`. Writes that RLS silently filters (0 rows) are turned into errors. The UI stops an admin changing their own role / active flag; the server separately refuses anything that leaves no active admin.

### `useInvestigationsStore` — [src/stores/investigations.js](src/stores/investigations.js)

Exports `STATUSES` (open / active / suspended / closed), `PRIORITIES` (low / medium / high / critical), `personLabel(p)`. List: `list`, `listLoading`, `listError`, `listFilters { status, search }`, `fetchList()` (latest activity first; counts via embedded `investigation_incidents(count)` / `investigation_notes(count)` filtered to `kind = note`), `setListFilters(patch)`. Current case: `current` (camelCased case + `incidents` (via `mapRow`, newest first) + `notes` (notes and events, newest first)), `fetchOne(id)`, `create(...)` → id, `update(id, patch)`, `remove(id)`, `linkIncidents(id, ids)` (upsert, duplicates ignored), `unlinkIncident`, `addNote`, `deleteNote`; mutations refetch the case so audit events show. Lookups: `fetchOfficers()` (active users whose role has `/investigations`), `searchIncidents(term)` (the table's 8 search columns, 25 rows), `casesForIncident(id)`, `openCases()`. The two `investigations → profiles` FKs need the hints `profiles!investigations_lead_id_fkey` / `profiles!investigations_created_by_fkey`. `incidents.js` exports `mapRow`, `sanitizeSearch`, `SEARCH_COLUMNS` for reuse.

### `usePersonsStore` — [src/stores/persons.js](src/stores/persons.js)

Exports `titleName(s)` (source names are all caps) and `bornLabel(min, max)`. Index: `filters { query, role, repeatOnly }`, `results`, `loading`, `error`, `search()` (→ `persons_search`; repeat-only = 2+ blotters, ignored while a name is typed), `setFilters(patch)`. Person: `current` (stats + `mentions` (one per incident row; the view folds a blotter's offense rows) + `associates` + `investigations`), `fetchPerson(id)` (→ `person_detail`, then `log_person_view`). `fetchMatches({ personId, includeAgeConflict, limit })` (→ `person_match_candidates`), `merge(keep, merge)`, `split(mentionId)`, `notSame(a, b)`, `forIncident(incidentId)` (parsed people on one incident + their blotter counts from the `person_stats` view).

### `useAssistantStore` — [src/stores/assistant.js](src/stores/assistant.js)

`threads` (key `case:<id>` or `general` → messages), `busy`, `thread(key)`, `ask(key, question, { investigationId })` (→ `supabase.functions.invoke('case-assistant')`; sends the previous turns as history **with tokens, never names**), `clear(key)`. Function errors are unwrapped from `error.context.json()`.

**Row cap:** Supabase's PostgREST returns at most **1000 rows per request** regardless of `.limit()` — this applies to RPCs returning row sets too. Any query that can exceed that goes through `fetchAllRows(build, limit)`, which pages with `.range()` (the builder must have a deterministic `.order()`). RPCs that return large sets should instead return a single `json` value (see `incidents_kde_grid`).

## Supabase Schema

Table: **`incidents`** (column names as stored in Postgres — `snake_case`).

| Column            | Notes                                             |
| ----------------- | ------------------------------------------------- |
| `id`              | Primary key                                       |
| `blotterno`       | Blotter / entry number (one blotter has many offenses, so not unique alone) |
| `date_encoded`    | When the record was encoded; source is Asia/Manila time, ingested with explicit `+08:00` |
| `ppo`             | Provincial Police Office                          |
| `stn`             | Station                                           |
| `region`          |                                                   |
| `municipal`       | Municipality / city                               |
| `barangay`        | Used as a filter dropdown                         |
| `street`          |                                                   |
| `type_of_place`   |                                                   |
| `date_reported`   |                                                   |
| `time_reported`   |                                                   |
| `date_committed`  | Used for date-range filter + default table sort   |
| `time_committed`  |                                                   |
| `incident_type`   | Shown as a table column                           |
| `offense`         | Used as a filter dropdown + table column          |
| `offense_type`    |                                                   |
| `modus`           |                                                   |
| `victim_raw`      | Raw victim text (searchable; to be parsed/embedded) |
| `suspect_raw`     | Raw suspect text (searchable; to be parsed/embedded) |
| `narrative`       | Full incident narrative (searchable; shown in detail panel) |
| `case_status`     | Used as a filter dropdown + status badge          |
| `case_solve_type` |                                                   |
| `lat`             | Latitude (map marker); nullable                   |
| `lng`             | Longitude (map marker); nullable                  |
| `geom`            | PostGIS `geometry(Point, 4326)`; auto-set from `lat`/`lng` by trigger; GiST-indexed |
| `embedding`       | pgvector `vector(384)` from Supabase `gte-small` (offense + modus + narrative, first 2,000 chars); HNSW cosine index; filled by the `embed-incidents` Edge Function |
| `created_at`      | Row insertion timestamp (`now()`)                 |
| `committed_at`    | `timestamptz` = `date_committed` + `time_committed` in Asia/Manila; auto-set by trigger; indexed. The single instant Knox needs. |
| `coord_flag`      | `null` = usable location; `'missing'` = no coords; `'stacked'` = shares an exact coordinate with ≥10 others (a default pin, e.g. 54 rows at 9.006126,125.660995). Set by `refresh_coord_flags()`. |

### Migrations ([supabase/migrations/](supabase/migrations/), apply in filename order)

| File | Adds |
| ---- | ---- |
| `20260618120000_init_incidents_schema.sql` | Extensions (PostGIS, pgvector), `incidents` table, GiST + filter indexes, `geom` trigger, RLS read policy for `anon`/`authenticated` |
| `20260618130000_blotterno_offense_unique.sql` | Replaces `unique(blotterno)` with **`unique(blotterno, offense)`** — one blotter entry can be filed under multiple offenses |
| `20260914100000_analysis_prep.sql` | `committed_at` + trigger + backfill; `coord_flag` + `refresh_coord_flags(min_repeats default 10)` |
| `20260914110000_kde_function.sql` | `incidents_kde(...)` — Gaussian KDE on a grid aligned to multiples of `cell_m`, distances in EPSG:32651 (UTM 51N), density in incidents/km², `weight` 0..1. Takes the same filters as the store (`p_date_from`, `p_date_to`, `p_barangay`, `p_offense`, `p_case_status`, `p_search`), excludes flagged coords unless `include_flagged`. |
| `20261021100000_kde_grid_json.sql` | `incidents_kde_grid(...)` — same args, returns the cells as one `json` array so the 1000-row cap can't truncate the surface. **The frontend calls this one.** |
| `20261021110000_fix_date_encoded_tz.sql` | One-time data fix: shifts pre-fix `date_encoded` values back 8h (they were stored as UTC). Guarded by a column-comment marker, so re-running is a no-op. |
| `20261102100000_kde_fast.sql` | Rewrites `incidents_kde` to enumerate only the cells within 3h of each point (plain arithmetic, no per-cell `ST_DWithin`). The original timed out under the anon `statement_timeout` on the full dataset. Same output; `cell_m` is floored at `bandwidth/20`. |
| `20261102110000_kde_faster.sql` | Further exact speed-ups to `incidents_kde` (identical coordinates grouped and weighted by count, per-column circle bounds, float8 math), and `statement_timeout = 15s` on `incidents_kde_grid` only — the full surface exceeded the anon role's default timeout on the free-tier instance. |
| `20261102120000_dashboard_function.sql` | `incidents_dashboard(p_date_from, p_date_to, p_category)` → one `json`: totals (crime/traffic/solved/cleared/under_investigation), `prev` (same-length window before, when both dates given), `by_status`, `by_month` (gap-filled), top-10 `by_barangay` / `by_offense`, `by_dow_hour` (isodow 1=Mon), `date_min`/`date_max`. |
| `20261102130000_analysis_points.sql` | `incidents_analysis_points(p_date_from, p_date_to, p_barangay, p_offense, p_case_status, p_search, p_category)` → one `json` array of `{id, blotterno, lat, lng, x, y (UTM 51N m), date_committed, barangay, offenses}`. **One point per blotter** (multi-offense blotters are one event; `offenses` joins them), flagged coords excluded. Search covers the same columns as the table search. |
| `20261102140000_patrol_zones.sql` | Drops + recreates `incidents_kde` / `incidents_kde_grid` with a trailing **`p_category`** param and the 8-column table search (grid keeps `statement_timeout = 15s`). Adds `incidents_patrol_zones(p_threshold, bandwidth_m, cell_m, filters…, p_category, p_min_incidents = 5)` → one `json`: KDE cells with weight ≥ threshold, unioned + closing-buffered (½ cell) into polygons; per zone `geojson`, `area_km2`, `peak_density`, `incidents` / `total` (distinct blotters), top-3 `top_offenses` / `barangays`, `by_dow`, `by_hour`; ordered by incidents. 15 s timeout. |
| `20261102150000_patrol_zones_sd.sql` | Replaces `p_threshold` with **`p_sd`** (default 2): zones are cells with density ≥ mean + `p_sd`·SD over the whole surface (Chainey's KDE hotspot threshold). A share-of-peak cut-off only ever found the one dominant Ampayon peak (next hotspots are ~20% of it). Adds `threshold` (the density cut-off, /km²) to each zone. |
| `20261103100000_auth_rbac.sql` | **Auth + RBAC.** `roles(id slug, name, description, pages text[] ⊆ the 5 app paths, is_system)` seeded with admin (all pages, locked), investigator (system), analyst, officer. `profiles(id → auth.users, email, full_name, rank, badge_no, role_id → roles (null = awaiting approval), active)`, auto-created by an `auth.users` insert trigger (email kept in sync; **the role is never read from user_metadata**). Security-definer helpers: `my_pages()`, `can_access(page)`, `has_app_access()`, `is_admin()` (= can open `/admin`), `admin_exists()`. `protect_roles` trigger: system roles keep their id and can't be deleted, admin pages are locked, clients can't set `is_system`; a statement trigger and `admin_update_user(p_user, p_role, p_active, p_full_name, p_rank, p_badge_no)` (admins only) refuse to leave no active admin. RLS: roles readable by authenticated, writable by admins; profiles readable by self or anyone with access; users may update only their own `full_name` / `rank` / `badge_no` (column grants). **`incidents` is now readable only by signed-in users with an active role** (anon removed); analysis RPCs revoked from anon; `refresh_coord_flags` is service_role only. |
| `20261103110000_investigations.sql` | `investigations` (bigint id, `case_no` INV-YYYY-0001 set by trigger, title, summary, status, priority, `lead_id` / `created_by` → profiles, `closed_at` maintained), `investigation_incidents` (case ↔ incident, PK pair, cascades both ways), `investigation_notes` (`kind` note / event). Triggers force `created_by` / `added_by` / `author_id` = `auth.uid()` and keep `case_no` / `created_*` immutable; security-definer audit triggers write `event` rows (opened, status / priority / lead / title changes, link / unlink) and bump `updated_at`. RLS: everything requires `can_access('/investigations')`; clients may insert only `kind = 'note'`; notes and links are never updated; deleting a case = its creator or an admin; deleting a note = its author or an admin. |
| `20261108100000_persons_index.sql` | **Persons index.** `pg_trgm`; new page **`/persons`** (roles constraint widened; added to admin + investigator with `roles_protect` briefly disabled). `persons` (display_name, name_norm (trigram-indexed), suffix, sex), `incident_persons` (one row per parsed person per incident row: role suspect/victim, raw, name/name_norm/suffix/alias, age, sex, status, occupation, placeholder, est_birth_year, source_hash, person_id, link_source auto/confirmed/split), `person_non_matches`, `person_events` (append-only audit: view/merge/split/not_same; admins read). `person_stats` view (security_invoker; counts over **distinct blotters**). Read RPCs (as caller): `persons_search(p_query, p_role, p_min_blotters, p_limit)`, `person_detail(p_id)` (mentions, associates, linked cases), `person_match_candidates(p_person, p_min_similarity 0.5, p_include_age_conflict, p_limit)` (trigram similarity, same sex, scored + evidence: age gap, shared barangays, shared associates; excludes rejected pairs). Write RPCs (security definer, check `can_access('/persons')`, audited): `merge_persons(keep, merge)`, `split_person_mention(mention)`, `mark_persons_not_same(a, b)`, `log_person_view(p_id)`. Clients have no direct write grants. |
| `20261108110000_similar_incidents_ai.sql` | `incidents.embedding` → `vector(384)` + HNSW cosine index. `match_incidents(p_embedding, p_limit, p_category, p_exclude_blotter, p_min_similarity 0.5)` and `similar_incidents(p_incident, p_limit)` (same crime/traffic category, other blotters, one row per blotter; as caller). `ai_requests` (actor, investigation, question, answer, tools, model, tokens, error; written by `case-assistant` with the service role; admins read). |
| `20261108120000_person_pairs.sql` | `person_pairs(person_a < person_b, similarity)`: similar-name pairs (pg_trgm-style trigram similarity >= 0.45, compatible sex) computed by `build-persons.js` on every build; cascades on person delete. `person_match_candidates` now reads these instead of a trigram self-join (which timed out on the global queue) and adds the evidence for the involved people only. A split-off record gets pairs on the next build. |

Data is loaded by [ingest.js](ingest.js) from the `crime_data/` folder; after inserting it calls `refresh_coord_flags()`, `buildPersons()` and `embedIncidents()` (each failure is a warning with the command to re-run). Every RPC's `p_search` covers the same eight columns as the table search.

**Access:** The browser uses the **anon** key plus the signed-in user's session; **Row Level Security** decides what each user sees (see `auth_rbac` / `investigations` above). Signed out, or signed in without an active role, `incidents` returns no rows. Every new table needs RLS with policies built on `can_access('<page>')`, and authorship columns set by trigger from `auth.uid()`. The `service_role` key must never appear in this client app.

**Users:** bootstrap the first admin with `bun scripts/create-user.js <email> <password> admin "Full Name"`. After that, add people with the same script, or set `VITE_ALLOW_SIGNUP=true` so they can use **Request access** on the sign-in page and an admin assigns a role on the Admin page. Self sign-up is **off by default** (development). Supabase's built-in email sender only delivers to the project's team members, so either configure custom SMTP or turn off *Confirm email* (Auth → Providers → Email); with it off, a new account still has no access until an admin approves it. Add the app's URL under Auth → URL Configuration (Site URL / redirect URLs) for confirmation links.

## Persons index & AI

**Persons** ([scripts/lib/persons.js](scripts/lib/persons.js), [scripts/build-persons.js](scripts/build-persons.js)): suspect_raw / victim_raw follow `NAME (age/sex/status/nationality/occupation)`, comma-separated, with parentheses possible inside the status — the parser splits only at top level. The build is incremental (md5 per incident + role); it never touches unchanged records, so investigators' merges/splits survive re-runs. Each build also recomputes `person_pairs` (all-pairs trigram similarity in JS, ~1 s for ~2,800 people). Automatic linking only on identical normalised name + suffix, compatible sex, and estimated birth year within ±3; placeholders (UNIDENTIFIED, JOHN DOE…) are never linked; everything fuzzier is a **suggestion** an investigator confirms or rejects. Wording rule everywhere: "named as suspect", never "offender"; no demographic scoring or prediction.

**Edge Functions** (deploy: `bunx supabase functions deploy <name> --project-ref <ref> --use-api` after `bunx supabase login`):

- `embed-incidents` — service role only (checks the JWT `role` claim; gateway verifies the signature). Embeds up to `limit` (≤25, default 5 — Edge Functions have a per-request CPU budget) incidents with `embedding is null`; returns `{ embedded, remaining }`.
- `case-assistant` — signed-in users with `/investigations` (person tools only with `/persons`). Body `{ question, investigationId?, history? }`. Tools: `search_incidents`, `semantic_search` (embeds the query with gte-small → `match_incidents`), `get_incident`, `get_case`, `similar_incidents`, `find_person`, `get_person`. Up to 5 tool rounds; each tool result is masked and capped at 4,000 chars (free tier ≈ 8K tokens/min). Masking: names of everyone on the returned incidents (full name and first name + surname, optional middle initials) → `P<person id>`; surname-only mentions are not caught, so enable Groq Zero Data Retention. Returns `{ answer, model, tools, people }` where `people` (token → name) is included only for `/persons` users. Logs every call to `ai_requests`. Secrets: `GROQ_API_KEY` (required), `GROQ_MODEL`, `GROQ_FALLBACK_MODEL`.

## Environment Variables

Vite exposes only `VITE_`-prefixed vars to the client. Copy [.env.example](.env.example) to `.env` and fill in:

| Variable                 | Description                                              |
| ------------------------ | ------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL (e.g. `https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase **anon** (public) key. RLS governs access.     |
| `VITE_ALLOW_SIGNUP`      | `true` shows **Request access** (self sign-up) on the sign-in page; anything else hides it (default, used during development). Match it with Supabase Auth → *Allow new users to sign up*. |

`ingest.js` and `scripts/create-user.js` additionally read `SUPABASE_URL` (optional, falls back to `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_KEY` from `.env`. `scripts/build-persons.js` and `scripts/embed-incidents.js` use the same two. AI keys are **not** in `.env`: `GROQ_API_KEY` is a Supabase Edge Function secret. `.env` is gitignored. The `service_role` key is for these server-side scripts only and must **never** be placed in a `VITE_` var or imported into `src/`. [src/lib/supabase.js](src/lib/supabase.js) throws on startup if either `VITE_` variable is missing.

## Next Steps

- **Patrol zone assignment** — Zones are computed on the fly. Add a `patrol_assignments` table (zone snapshot geometry, unit/officer → profiles, shift, `created_by` set by trigger) with RLS on `can_access('/hotspot-map')`, so supervisors can save and assign zones.
- **Audit viewer** — Admin page tab for `ai_requests` and `person_events` (who asked what / who viewed or merged whom).
- **MCP server** — The case-assistant tools could also be exposed as an MCP server (same RLS-scoped queries) for desktop AI clients.
- **Persons in cases** — A "People in this case" section on the investigation page (persons across the linked incidents).
- **Admin-created accounts / invites** — Today users self-register and an admin approves them. Creating or inviting users from the Admin page needs a Supabase Edge Function holding the service key that checks `is_admin()` for the caller. Never use a service-role client in the browser.
- **Audit of record views** — Person views are logged (`person_events`); extend to incidents / cases if policy requires it.
