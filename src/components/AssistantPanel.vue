<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAssistantStore } from '../stores/assistant'
import { useAuthStore } from '../stores/auth'
import { useIncidentsStore } from '../stores/incidents'
import { useInvestigationsStore } from '../stores/investigations'
import { titleName } from '../stores/persons'

// "Ask AI" panel. Answers come back with person tokens (P123) and blotter
// citations ([2024-00123]); both are rendered as links, never as raw HTML.
const props = defineProps({
  investigationId: { type: Number, default: null },
})

const store = useAssistantStore()
const auth = useAuthStore()
const router = useRouter()
const incidents = useIncidentsStore()
const investigations = useInvestigationsStore()

const key = computed(() => (props.investigationId ? `case:${props.investigationId}` : 'general'))
const messages = computed(() => store.thread(key.value))
const draft = ref('')
const listEl = ref(null)
const saved = ref({})

const SUGGESTIONS = computed(() =>
  props.investigationId
    ? [
        'Summarize this case and its incidents.',
        'Describe the unidentified suspects across these incidents.',
        'Which other incidents look similar to these?',
        'Who is named in more than one of these blotters?',
      ]
    : ['Find incidents similar to a motorcycle theft at night near a market.']
)

async function send(text = draft.value) {
  if (!text.trim()) return
  draft.value = ''
  await store.ask(key.value, text, { investigationId: props.investigationId })
}

watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  }
)

// Split an answer into text / person / citation parts.
function parts(msg) {
  const out = []
  const re = /\b(P\d+)\b|\[([^\]\n]{3,40})\]/g
  let last = 0
  let m
  while ((m = re.exec(msg.content))) {
    if (m.index > last) out.push({ type: 'text', text: msg.content.slice(last, m.index) })
    if (m[1]) out.push({ type: 'person', token: m[1], id: Number(m[1].slice(1)), name: msg.people?.[m[1]] })
    else out.push({ type: 'cite', blotter: m[2] })
    last = re.lastIndex
  }
  if (last < msg.content.length) out.push({ type: 'text', text: msg.content.slice(last) })
  return out
}

function openBlotter(blotter) {
  if (!auth.canAccess('/incidents')) return
  incidents.applyFilters({ search: blotter, dateFrom: '', dateTo: '', barangay: '', offense: '', caseStatus: '' })
  router.push('/incidents')
}

// Save an answer to the case timeline, with names filled in (the note stays in Supabase).
async function saveAsNote(msg, i) {
  const body = msg.content.replace(/\b(P\d+)\b/g, (t) =>
    msg.people?.[t] ? `${titleName(msg.people[t])} (${t})` : t
  )
  try {
    await investigations.addNote(props.investigationId, `AI-assisted summary (verify against the blotters):\n${body}`)
    saved.value = { ...saved.value, [i]: true }
  } catch (e) {
    alert(e.message || String(e))
  }
}
</script>

<template>
  <section class="assistant">
    <header>
      <h3>Ask AI</h3>
      <button v-if="messages.length" class="link-btn" @click="store.clear(key)">Clear</button>
    </header>
    <p class="disclaimer">
      AI-generated from the records you can access. It can be wrong: check every claim against the cited blotters.
      Names on records are masked before anything is sent to the AI service; names you type are sent as typed.
    </p>

    <div ref="listEl" class="messages">
      <div v-if="!messages.length" class="suggestions">
        <button v-for="s in SUGGESTIONS" :key="s" class="suggestion" :disabled="store.busy" @click="send(s)">{{ s }}</button>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="[m.role, { error: m.error }]">
        <template v-if="m.role === 'assistant' && !m.error">
          <p class="body">
            <template v-for="(p, j) in parts(m)" :key="j">
              <span v-if="p.type === 'text'">{{ p.text }}</span>
              <RouterLink
                v-else-if="p.type === 'person' && p.name && auth.canAccess('/persons')"
                :to="{ name: 'person', params: { id: p.id } }"
                class="person"
                >{{ titleName(p.name) }}</RouterLink
              >
              <span v-else-if="p.type === 'person'" class="person token" title="Masked person">{{ p.token }}</span>
              <button v-else class="cite" :title="`Open blotter ${p.blotter}`" @click="openBlotter(p.blotter)">
                {{ p.blotter }}
              </button>
            </template>
          </p>
          <div class="msg-foot">
            <span class="muted">{{ m.tools?.length ? `looked up: ${[...new Set(m.tools)].join(', ')}` : '' }}</span>
            <button
              v-if="investigationId"
              class="link-btn"
              :disabled="saved[i]"
              @click="saveAsNote(m, i)"
            >
              {{ saved[i] ? 'Saved to case' : 'Save as case note' }}
            </button>
          </div>
        </template>
        <p v-else class="body">{{ m.content }}</p>
      </div>
      <div v-if="store.busy" class="msg assistant thinking">Looking through the records…</div>
    </div>

    <form class="composer" @submit.prevent="send()">
      <textarea
        v-model="draft"
        rows="2"
        placeholder="Ask about this case, its incidents or the people named…"
        :disabled="store.busy"
        @keydown.enter.exact.prevent="send()"
      ></textarea>
      <button class="btn primary" type="submit" :disabled="store.busy || !draft.trim()">Ask</button>
    </form>
  </section>
</template>

<style scoped>
.assistant {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.disclaimer {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.messages {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggestion {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.suggestion:hover:not(:disabled) {
  border-color: var(--accent);
}

.msg {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
}

.msg.user {
  align-self: flex-end;
  max-width: 85%;
  background: rgba(232, 93, 4, 0.12);
  color: var(--text);
}

.msg.assistant {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
}

.msg.error {
  border-color: rgba(248, 81, 73, 0.4);
  color: #f8716a;
}

.msg.thinking {
  color: var(--text-muted);
  font-style: italic;
}

.body {
  white-space: pre-wrap;
  word-break: break-word;
}

.person {
  font-weight: 600;
  color: var(--text);
  text-decoration: underline dotted var(--text-muted);
}

.person.token {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.06);
  padding: 0 4px;
  border-radius: 4px;
}

.cite {
  font-family: inherit;
  font-size: 11px;
  padding: 0 6px;
  margin: 0 1px;
  border-radius: 4px;
  border: 1px solid rgba(57, 135, 229, 0.4);
  background: rgba(57, 135, 229, 0.12);
  color: #6da7ec;
  cursor: pointer;
  vertical-align: baseline;
}

.msg-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
}

.muted {
  color: var(--text-muted);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.link-btn:hover:not(:disabled) {
  color: var(--accent);
}

.link-btn:disabled {
  cursor: default;
}

.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

textarea {
  flex: 1;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
