# Crime Mapper

AI-assisted geospatial crime analysis dashboard for **PNP Butuan City Police Station 4**. Officers can browse, filter, and search incidents, and see them on a map with a PostGIS-computed kernel-density (KDE) hotspot layer.

Built with Vue 3, Vite, Pinia, Vue Router, Leaflet, and Supabase (PostgreSQL + PostGIS + pgvector).

## Setup

Uses [Bun](https://bun.sh) as the package manager and script runner.

```sh
bun install
cp .env.example .env   # then fill in the values (see below)
bun run dev
```

### Environment

| Variable                 | Used by   | Notes                                                        |
| ------------------------ | --------- | ------------------------------------------------------------ |
| `VITE_SUPABASE_URL`      | browser   | `https://<ref>.supabase.co`                                  |
| `VITE_SUPABASE_ANON_KEY` | browser   | Public anon key. Row Level Security decides what each signed-in user can read and write. |
| `SUPABASE_URL`           | scripts   | Optional; falls back to `VITE_SUPABASE_URL`.                 |
| `SUPABASE_SERVICE_KEY`   | scripts   | **service_role key for `ingest.js` / `scripts/create-user.js` only. Never prefix with `VITE_`.** |

### Database

Apply the migrations in [supabase/migrations/](supabase/migrations/) in filename order, via `supabase db push` or the Supabase SQL editor. They create the `incidents` table, spatial and time indexes, the coordinate-quality flags, the analysis functions (KDE, dashboard, Knox points, patrol zones), user profiles with roles, investigations, and the Row Level Security that ties them together.

### Users and roles

Incident data is only visible to signed-in users with an active role. Create the first administrator from the command line:

```sh
bun scripts/create-user.js you@example.com 'a-strong-password' admin "PMaj Juan Dela Cruz"
```

Add other people with the same script (any role id: `admin`, `investigator`, `analyst`, `officer`). Self sign-up (**Request access**) is off by default; set `VITE_ALLOW_SIGNUP=true` in `.env` and enable *Allow new users to sign up* in Supabase Auth to turn it on. New sign-ups then wait for an administrator to assign a role on the **Admin** page. Roles are lists of pages (Dashboard, Incidents, Hotspot Map, Investigations, Admin) and can be edited under **Admin → Roles & access**.

In the Supabase dashboard:

- **Auth → Providers → Email:** Supabase's built-in mailer only delivers to project team members. Either set up custom SMTP or turn off *Confirm email*. New accounts have no access until approved either way.
- **Auth → URL Configuration:** set the Site URL / redirect URLs to where the app runs (for example `http://localhost:5173`).

### Loading data

Put the PNP "8 Focus Crimes" `.xlsx` exports in `crime_data/`, then:

```sh
bun ingest.js --dry-run    # preview the mapped rows, no writes
bun ingest.js              # insert (duplicates by blotterno + offense are skipped)
```

The ingest re-runs `refresh_coord_flags()` afterwards, so incidents with missing or default-pinned coordinates stay out of the map and hotspot analysis.

> The spreadsheets contain real victim and suspect data. `*.xlsx` and `.env` are gitignored — keep it that way.

### Persons index and AI

The **Persons** page links people named in blotters across incidents. Exact matches are linked automatically; everything else is a suggestion an investigator confirms. **Similar incidents** and the case page's **Ask AI** panel run in Supabase Edge Functions:

- narrative embeddings use Supabase's built-in `gte-small` model (free; the text stays in Supabase);
- the assistant uses Groq's free API (`openai/gpt-oss-120b`). Names from records are masked before anything is sent, and every request is logged.

One-time setup:

```sh
bunx supabase login
bunx supabase functions deploy embed-incidents --project-ref <ref> --use-api
bunx supabase functions deploy case-assistant --project-ref <ref> --use-api
bun scripts/build-persons.js     # parse suspects/victims into the persons index
bun scripts/embed-incidents.js   # embed every narrative
```

Create a free Groq key at [console.groq.com](https://console.groq.com) (turn on **Zero Data Retention** under Data Controls) and save it in Supabase → Edge Functions → Secrets as `GROQ_API_KEY`. After that, `bun ingest.js` keeps both up to date.

## Scripts

| Command           | Description               |
| ----------------- | ------------------------- |
| `bun run dev`     | Vite dev server           |
| `bun run build`   | Production build → `dist/`|
| `bun run preview` | Serve the built `dist/`   |
| `bun run create-user -- <email> <password> [role] [name]` | Create or update a user and set their role (service key) |
| `bun scripts/build-persons.js [--dry-run]` | Refresh the persons index from suspect/victim fields (service key) |
| `bun scripts/embed-incidents.js` | Embed narratives without embeddings via the Edge Function (service key) |

See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and the schema reference.
