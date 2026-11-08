<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

// Public front page (signed out). Styled after the station's own paperwork:
// duty-board strip, a marked-up patrol map, the blotter book, a route map and
// a memorandum. Deliberately shows no real data: the map is illustrative and
// carries no real hotspots, patrol windows or names.
const auth = useAuthStore()

// Military time in Manila, e.g. "MON 09 NOV 2026 · 2214H".
const clock = ref('')
function tick() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  )
  clock.value = `${parts.weekday} ${parts.day} ${parts.month} ${parts.year} · ${parts.hour}${parts.minute}H`.toUpperCase()
}
let timer = null
onMounted(() => {
  tick()
  timer = setInterval(tick, 15000)
})
onBeforeUnmount(() => clearInterval(timer))

const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const ENTRIES = [
  {
    no: '001',
    tool: 'Dashboard',
    asks: 'How is the station doing this year, and where and when do incidents bunch up?',
    note: 'Clearance (CCE) and solution (CSE) efficiency, monthly trend, busiest barangays, day-and-hour grid.',
    who: 'All roles',
  },
  {
    no: '002',
    tool: 'Incidents',
    asks: 'What exactly was recorded, where, and what happened?',
    note: 'The full blotter, searchable across narratives, names and places.',
    who: 'Analyst · Investigator',
  },
  {
    no: '003',
    tool: 'Hotspot map',
    asks: 'Where should patrols be, and at what hours?',
    note: 'Density surface from every mapped incident, with priority zones and their busiest days and three-hour windows.',
    who: 'All roles',
  },
  {
    no: '004',
    tool: 'Near-repeat test',
    asks: 'After one incident, is another nearby, soon, more likely than chance?',
    note: 'Knox space-time test with permutation significance, the method behind the Near Repeat Calculator.',
    who: 'All roles',
  },
  {
    no: '005',
    tool: 'Investigations',
    asks: 'What do we know about this case, and who is working it?',
    note: 'Linked incidents, notes, a lead investigator and an automatic record of every change.',
    who: 'Investigator',
  },
  {
    no: '006',
    tool: 'Persons index',
    asks: 'Has this name come up in other blotters?',
    note: 'Exact matches are linked; possible matches wait for an investigator to confirm or reject.',
    who: 'Investigator',
  },
  {
    no: '007',
    tool: 'Ask AI',
    asks: 'Summarise this case. What else reads like it?',
    note: 'Answers cite the blotter they came from. Names are masked before anything leaves the station’s database.',
    who: 'Investigator',
  },
]

const ROUTE = [
  { name: 'Encoded', note: 'The desk officer records the blotter: place, time, offense, the people involved.' },
  { name: 'Placed', note: 'Coordinates are checked. Default pins and missing locations are flagged and kept off the map.' },
  { name: 'Patterned', note: 'Hotspots and near-repeat windows are computed from the whole record, not one shift’s memory.' },
  { name: 'Worked', note: 'Related entries become a case, with notes, a lead and a full audit trail.' },
  { name: 'Patrolled', note: 'Priority zones go out with the days and hours they are busiest.' },
]
</script>

<template>
  <div class="landing">
    <!-- Duty-board strip -->
    <div class="strip">
      <span>PNP <i class="star">★</i> Butuan City Police Station 4 <i class="star">★</i> PRO 13 Caraga</span>
      <span class="strip-mid">Authorized personnel only</span>
      <span class="strip-clock" aria-label="Manila time">{{ clock }}</span>
    </div>

    <header class="masthead">
      <div class="wordmark">
        <!-- Eight-rayed sun, after the flag's (one ray per province of 1896). -->
        <svg class="mark" viewBox="-20 -20 40 40" aria-hidden="true">
          <rect x="-20" y="-20" width="40" height="40" rx="3" class="mark-bg" />
          <g class="mark-sun">
            <polygon v-for="i in 8" :key="i" points="0,-16.5 2.4,-8.2 -2.4,-8.2" :transform="`rotate(${i * 45})`" />
            <circle r="6.4" />
          </g>
        </svg>
        <span>
          <strong>Crime Mapper</strong>
          <small>Station 4 incident analysis</small>
        </span>
      </div>
      <nav class="nav">
        <button @click="go('desk')">On the desk</button>
        <button @click="go('route')">Blotter to patrol</button>
        <button @click="go('rules')">Ground rules</button>
        <RouterLink v-if="auth.user" :to="auth.homePath" class="signin">Open the system</RouterLink>
        <RouterLink v-else to="/login" class="signin">Sign in</RouterLink>
      </nav>
    </header>
    <div class="flag-rule" aria-hidden="true"></div>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-copy">
        <p class="kicker">Incident analysis · Butuan City</p>
        <h1>
          Every blotter entry is a place, a time and a name.
          <span>This puts all three on one desk.</span>
        </h1>
        <p class="filipino" lang="fil">Bawat blotter: may lugar, may oras, may pangalan.</p>
        <p class="lede">
          Crime Mapper reads Station 4’s blotter records and turns them into the questions a duty officer actually asks:
          where to patrol, when, what is repeating, and who keeps coming up. It is a working tool for the station, not a
          public service.
        </p>
        <div class="hero-actions">
          <RouterLink v-if="auth.user" :to="auth.homePath" class="btn ink">Open the system</RouterLink>
          <RouterLink v-else to="/login" class="btn ink">Sign in</RouterLink>
          <button class="btn plain" @click="go('desk')">See what’s inside ↓</button>
        </div>
        <p class="fine">
          Accounts are issued by the station administrator. To report a crime or an emergency, call
          <strong>911</strong> or go to the nearest station.
        </p>
      </div>

      <figure class="map-card">
        <svg viewBox="0 0 480 400" role="img" aria-label="Illustrative patrol map: the Agusan River on a lettered grid, with an example priority zone and near-repeat links">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#c2410c" stroke-width="1" opacity="0.35" />
            </pattern>
          </defs>

          <!-- bay -->
          <path d="M0 0 H150 C130 30 95 40 70 70 C50 95 20 100 0 110 Z" class="bay" />
          <text x="14" y="30" class="lbl water">Butuan Bay</text>

          <!-- grid -->
          <g class="grid">
            <line v-for="i in 5" :key="`v${i}`" :x1="i * 80" y1="0" :x2="i * 80" y2="400" />
            <line v-for="i in 4" :key="`h${i}`" x1="0" :y1="i * 80" x2="480" :y2="i * 80" />
          </g>
          <g class="grid-labels">
            <text v-for="(c, i) in ['A', 'B', 'C', 'D', 'E', 'F']" :key="c" :x="i * 80 + 72" y="14">{{ c }}</text>
            <text v-for="i in 5" :key="`r${i}`" x="5" :y="(i - 1) * 80 + 74">{{ i }}</text>
          </g>

          <!-- highway -->
          <path d="M120 400 C170 330 240 300 300 250 S420 170 480 150" class="road" />
          <text x="384" y="196" class="lbl road-lbl" transform="rotate(-20 384 196)">national highway</text>

          <!-- river: banks then water -->
          <path class="river bank" d="M470 400 C430 360 360 380 340 330 S380 250 320 220 S200 230 190 180 S230 110 170 80 S95 70 60 40" />
          <path class="river water" d="M470 400 C430 360 360 380 340 330 S380 250 320 220 S200 230 190 180 S230 110 170 80 S95 70 60 40" />
          <text x="214" y="232" class="lbl water" transform="rotate(10 214 232)">Agusan River</text>

          <!-- example priority zone -->
          <path d="M92 262 L150 246 L178 280 L164 330 L108 338 L82 300 Z" class="zone" />
          <circle cx="130" cy="292" r="10" class="ring r1" />
          <circle cx="130" cy="292" r="22" class="ring r2" />
          <circle cx="130" cy="292" r="36" class="ring r3" />
          <line x1="164" y1="330" x2="226" y2="368" class="leader" />
          <text x="230" y="372" class="note">PRIORITY ZONE (example)</text>
          <text x="230" y="386" class="note sub">busiest days · 3-hour window</text>

          <!-- example near-repeat links -->
          <g class="nr">
            <line x1="392" y1="62" x2="414" y2="80" />
            <line x1="414" y1="80" x2="400" y2="104" />
            <circle cx="392" cy="62" r="4" />
            <circle cx="414" cy="80" r="4" />
            <circle cx="400" cy="104" r="4" />
          </g>
          <line x1="398" y1="108" x2="378" y2="122" class="leader" />
          <text x="306" y="134" class="note">NEAR-REPEAT (example)</text>
          <text x="306" y="148" class="note sub">≤ 100 m · ≤ 7 days apart</text>

          <!-- north arrow -->
          <g class="north" transform="translate(452 352)">
            <path d="M0 -18 L7 6 L0 1 L-7 6 Z" />
            <text x="0" y="22">N</text>
          </g>
        </svg>
        <figcaption>Illustrative, not to scale. No real case data appears on this page.</figcaption>
      </figure>
    </section>

    <!-- The blotter book -->
    <section id="desk" class="section">
      <div class="section-head">
        <p class="kicker">On the desk</p>
        <h2>Seven tools, entered like a blotter book.</h2>
      </div>
      <div class="ledger" role="table" aria-label="Tools in Crime Mapper">
        <div class="ledger-row head" role="row">
          <span role="columnheader">Entry</span>
          <span role="columnheader">Tool</span>
          <span role="columnheader">The question it answers</span>
          <span role="columnheader">Opened by</span>
        </div>
        <div v-for="e in ENTRIES" :key="e.no" class="ledger-row" role="row">
          <span class="no" role="cell">{{ e.no }}</span>
          <span class="tool" role="cell">{{ e.tool }}</span>
          <span class="asks" role="cell">
            {{ e.asks }}
            <small>{{ e.note }}</small>
          </span>
          <span class="who" role="cell">{{ e.who }}</span>
        </div>
      </div>
      <p class="aside">Administrators also manage accounts and decide which roles can open which pages.</p>
    </section>

    <!-- Route map -->
    <section id="route" class="section route-section">
      <div class="section-head">
        <p class="kicker">From blotter to patrol</p>
        <h2>One entry, five stops.</h2>
      </div>
      <ol class="route">
        <li v-for="(s, i) in ROUTE" :key="s.name">
          <span class="stop" aria-hidden="true">{{ i + 1 }}</span>
          <strong>{{ s.name }}</strong>
          <p>{{ s.note }}</p>
        </li>
      </ol>
    </section>

    <!-- Memorandum -->
    <section id="rules" class="section">
      <article class="memo">
        <span class="stamp" aria-hidden="true">For official<br />use only</span>
        <header class="memo-head">
          <p class="memo-title">Memorandum</p>
          <dl>
            <dt>For</dt>
            <dd>All Crime Mapper users</dd>
            <dt>From</dt>
            <dd>Station administrator</dd>
            <dt>Subject</dt>
            <dd>Ground rules for using station records</dd>
          </dl>
        </header>
        <ol class="memo-rules">
          <li><strong>Access is by role.</strong> Every account is issued by an administrator, and each role opens only the pages it needs.</li>
          <li><strong>Named is not guilty.</strong> A person named in a blotter is recorded as “named as suspect”, never as an offender.</li>
          <li><strong>Links are proposed, not assumed.</strong> Records are joined automatically only on an exact match; everything else waits for an investigator.</li>
          <li><strong>No profiling.</strong> The system does not score or predict people by age, sex, occupation or origin.</li>
          <li><strong>The AI sees tokens, not names.</strong> Names are masked before any text reaches the AI service, and every question asked is logged.</li>
          <li><strong>Handle as personal data.</strong> Records fall under the Data Privacy Act of 2012 (RA 10173). Do not copy, photograph or share them outside official duty.</li>
        </ol>
      </article>
    </section>

    <div class="flag-rule" aria-hidden="true"></div>
    <footer class="footer">
      <div>
        <strong>Crime Mapper <i class="star">★ ★ ★</i></strong>
        <span>Butuan City Police Station 4 · Agusan del Norte</span>
      </div>
      <div>
        <span>For official use. Unauthorized access is prohibited and logged.</span>
        <span>Emergency: <strong>911</strong></span>
      </div>
      <RouterLink v-if="!auth.user" to="/login" class="footer-link">Sign in →</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  --paper: #f1ece1;
  --paper-2: #e7e0d0;
  --ink: #1b1a17;
  --ink-2: #57534a;
  --rule: #cdc4b1;
  /* Philippine flag: royal blue, scarlet, sun gold (gold only on blue). */
  --blue: #0038a8;
  --red: #ce1126;
  --gold: #fcd116;
  --stamp: var(--red);
  --navy: var(--blue);
  --display: 'Barlow Condensed', 'Arial Narrow', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;

  min-height: 100%;
  background: var(--paper);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.6;
  color-scheme: light;
}

/* ---------- strip ---------- */
.strip {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 32px;
  background: var(--navy);
  color: #d9dfe9;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.strip {
  color: #e8edf8;
}

.strip-mid {
  color: var(--gold);
}

.star {
  font-style: normal;
  color: var(--gold);
  margin: 0 4px;
}

/* The flag as a ribbon: blue over red, white triangle with the sun at the hoist. */
.flag-rule {
  position: relative;
  height: 12px;
  background: linear-gradient(var(--blue) 0 50%, var(--red) 50% 100%);
}

.flag-rule::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 22px;
  background: #fff;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

.flag-rule::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.strip-clock {
  font-variant-numeric: tabular-nums;
}

/* ---------- masthead ---------- */
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 18px 32px;
}

.wordmark {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mark {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.mark-bg {
  fill: var(--blue);
}

.mark-sun {
  fill: var(--gold);
}

.wordmark strong {
  display: block;
  font-family: var(--display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
}

.wordmark small {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-2);
  letter-spacing: 0.04em;
}

.nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav button {
  background: none;
  border: none;
  padding: 8px 12px;
  font-family: var(--display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-2);
  cursor: pointer;
}

.nav button:hover {
  color: var(--ink);
}

.signin {
  margin-left: 8px;
  padding: 7px 16px;
  border: 2px solid var(--stamp);
  color: var(--stamp);
  font-family: var(--display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.signin:hover {
  background: var(--stamp);
  color: var(--paper);
}

/* ---------- hero ---------- */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 56px;
  align-items: center;
  max-width: 1240px;
  margin: 0 auto;
  padding: 64px 32px 72px;
}

.kicker {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--stamp);
  margin-bottom: 14px;
}

h1 {
  font-family: var(--display);
  font-size: clamp(42px, 5.4vw, 72px);
  font-weight: 600;
  line-height: 0.98;
  letter-spacing: -0.005em;
}

h1 span {
  display: block;
  margin-top: 10px;
  color: var(--blue);
}

.filipino {
  margin-top: 14px;
  font-family: var(--mono);
  font-size: 13px;
  font-style: italic;
  color: var(--red);
  letter-spacing: 0.02em;
}

.lede {
  margin-top: 24px;
  max-width: 34em;
  font-size: 17px;
  color: var(--ink);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.btn {
  padding: 12px 22px;
  font-family: var(--display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 2px solid var(--ink);
  cursor: pointer;
}

.btn.ink {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn.ink:hover {
  background: var(--red);
  border-color: var(--red);
}

.btn.plain {
  background: transparent;
  color: var(--ink);
}

.btn.plain:hover {
  background: var(--paper-2);
}

.fine {
  margin-top: 18px;
  font-size: 13px;
  color: var(--ink-2);
  max-width: 34em;
}

.fine strong {
  color: var(--ink);
}

/* ---------- map ---------- */
.map-card {
  background: #f8f5ee;
  border: 1.5px solid var(--ink);
  box-shadow: 8px 8px 0 var(--paper-2);
  padding: 14px;
}

.map-card svg {
  display: block;
  width: 100%;
  height: auto;
}

.map-card figcaption {
  margin-top: 10px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-2);
}

.bay {
  fill: #d7e1e3;
}

.grid line {
  stroke: var(--rule);
  stroke-width: 1;
}

.grid-labels text {
  font-family: var(--mono);
  font-size: 10px;
  fill: var(--ink-2);
}

.road {
  fill: none;
  stroke: #8f877a;
  stroke-width: 2;
  stroke-dasharray: 7 5;
}

.lbl {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.lbl.water {
  fill: #4b6b78;
  font-style: italic;
}

.road-lbl {
  fill: #6f685c;
}

.river {
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 900;
  stroke-dashoffset: 900;
  animation: draw 2.4s ease-out 0.2s forwards;
}

.river.bank {
  stroke: #8fa9b4;
  stroke-width: 13;
}

.river.water {
  stroke: #cddbe0;
  stroke-width: 8;
}

@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}

.zone {
  fill: url(#hatch);
  stroke: var(--stamp);
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
}

.ring {
  fill: none;
  stroke: var(--stamp);
}

.r1 {
  stroke-width: 2;
}

.r2 {
  stroke-width: 1.5;
  opacity: 0.6;
}

.r3 {
  stroke-width: 1;
  opacity: 0.35;
}

.leader {
  stroke: var(--ink);
  stroke-width: 0.8;
}

.note {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  fill: var(--ink);
  letter-spacing: 0.04em;
}

.note.sub {
  font-weight: 400;
  fill: var(--ink-2);
}

.nr line {
  stroke: var(--navy);
  stroke-width: 1.5;
}

.nr circle {
  fill: var(--navy);
}

.north path {
  fill: var(--ink);
}

.north text {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
  text-anchor: middle;
  fill: var(--ink);
}

/* ---------- sections ---------- */
.section {
  max-width: 1240px;
  margin: 0 auto;
  padding: 72px 32px;
  border-top: 1px solid var(--rule);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-bottom: 28px;
}

.section-head .kicker {
  margin: 0;
}

h2 {
  font-family: var(--display);
  font-size: clamp(30px, 3.4vw, 44px);
  font-weight: 600;
  line-height: 1.05;
}

/* ---------- ledger ---------- */
.ledger {
  border: 1.5px solid var(--ink);
  background: #f8f5ee;
}

.ledger-row {
  display: grid;
  grid-template-columns: 76px 190px minmax(0, 1fr) 180px;
  border-top: 1px solid var(--rule);
}

.ledger-row > span {
  padding: 14px 16px;
  border-left: 1px solid var(--rule);
}

.ledger-row > span:first-child {
  border-left: none;
}

.ledger-row.head {
  border-top: none;
  background: var(--blue);
  color: #fff;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ledger-row.head > span {
  padding: 9px 16px;
  border-left-color: rgba(255, 255, 255, 0.25);
}

.ledger {
  border-color: var(--blue);
}

.ledger-row:not(.head):hover {
  background: #fffdf7;
}

.no {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--stamp);
}

.tool {
  font-family: var(--display);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
}

.asks {
  font-size: 15px;
}

.asks small {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-2);
}

.who {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-2);
}

.aside {
  margin-top: 14px;
  font-size: 13px;
  color: var(--ink-2);
}

/* ---------- route map ---------- */
.route {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  position: relative;
  padding-top: 8px;
}

.route::before {
  content: '';
  position: absolute;
  top: 25px;
  left: 10%;
  right: 10%;
  height: 6px;
  background: var(--blue);
}

.route li {
  position: relative;
  text-align: center;
  padding: 0 12px;
}

.stop {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--paper);
  border: 5px solid var(--blue);
  color: var(--blue);
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
}

.route li:last-child .stop {
  border-color: var(--red);
  background: var(--gold);
  color: var(--ink);
}

.route strong {
  display: block;
  margin-top: 12px;
  font-family: var(--display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.route p {
  margin-top: 6px;
  font-size: 14px;
  color: var(--ink-2);
}

/* ---------- memo ---------- */
.memo {
  position: relative;
  max-width: 860px;
  margin: 0 auto;
  background: #fbf9f3;
  border: 1px solid var(--rule);
  box-shadow: 0 1px 0 var(--rule), 0 14px 30px -18px rgba(27, 26, 23, 0.35);
  padding: 44px 52px 48px;
}

.memo-title {
  font-family: var(--display);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.memo-head dl {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 4px 0;
  margin-top: 14px;
  padding-bottom: 18px;
  border-bottom: 2px solid var(--ink);
  font-family: var(--mono);
  font-size: 13px;
}

.memo-head dt {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.memo-head dt::after {
  content: ':';
}

.memo-rules {
  margin-top: 24px;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.memo-rules li {
  padding-left: 6px;
}

.memo-rules li::marker {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--stamp);
}

.stamp {
  position: absolute;
  top: 30px;
  right: 40px;
  padding: 8px 14px;
  border: 3px solid var(--stamp);
  border-radius: 4px;
  color: var(--stamp);
  font-family: var(--display);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
  transform: rotate(-7deg);
  opacity: 0.85;
  mix-blend-mode: multiply;
}

/* ---------- footer ---------- */
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px 32px;
  padding: 28px 32px;
  background: var(--navy);
  color: #dde4f3;
  font-size: 13px;
}

.footer .star {
  margin-left: 6px;
  font-size: 11px;
  letter-spacing: 2px;
}

.footer div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.footer strong {
  color: #fff;
}

.footer-link {
  font-family: var(--display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--gold);
}

/* ---------- small screens ---------- */
@media (max-width: 960px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 40px;
    padding-top: 40px;
  }

  .ledger-row {
    grid-template-columns: 60px minmax(0, 1fr);
  }

  .ledger-row.head {
    display: none;
  }

  .ledger-row > span {
    border-left: none;
    padding: 4px 16px;
  }

  .ledger-row .no {
    grid-row: span 3;
    padding-top: 16px;
  }

  .ledger-row .tool {
    padding-top: 14px;
  }

  .ledger-row .who {
    padding-bottom: 14px;
  }

  .route {
    grid-template-columns: 1fr;
    gap: 22px;
  }

  .route::before {
    top: 10px;
    bottom: 10px;
    left: 19px;
    right: auto;
    width: 6px;
    height: auto;
  }

  .route li {
    text-align: left;
    display: grid;
    grid-template-columns: 40px 1fr;
    column-gap: 16px;
    padding: 0;
  }

  .route li strong {
    margin-top: 6px;
  }

  .route li p {
    grid-column: 2;
    margin-top: 0;
  }
}

@media (max-width: 640px) {
  .strip {
    padding: 7px 16px;
  }

  .strip-mid,
  .nav button {
    display: none;
  }

  .masthead,
  .hero,
  .section,
  .footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .memo {
    padding: 32px 22px 34px;
  }

  .stamp {
    position: static;
    display: inline-block;
    margin-bottom: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .river {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>
