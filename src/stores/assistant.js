import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

// Turn a functions.invoke error into the function's own { error } message.
async function invokeError(error) {
  try {
    const body = await error.context?.json()
    if (body?.error) return body.error
  } catch {
    /* not JSON */
  }
  return error.message || String(error)
}

// Conversations with the case-assistant Edge Function, one thread per case
// (key 'case:<id>') or 'general'. Answers are kept exactly as returned (with
// P123 person tokens) and sent back as history, so real names never go to the
// model through the history either.
export const useAssistantStore = defineStore('assistant', () => {
  const threads = ref({}) // key -> [{ role, content, people?, tools?, model?, error? }]
  const busy = ref(false)

  const thread = (key) => threads.value[key] || []

  async function ask(key, question, { investigationId = null } = {}) {
    const q = question.trim()
    if (!q || busy.value) return
    const t = (threads.value[key] ??= [])
    const history = t.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
    t.push({ role: 'user', content: q })
    busy.value = true
    try {
      const { data, error } = await supabase.functions.invoke('case-assistant', {
        body: { question: q, investigationId, history },
      })
      if (error) throw new Error(await invokeError(error))
      t.push({
        role: 'assistant',
        content: data.answer,
        people: data.people || {},
        tools: data.tools || [],
        model: data.model,
      })
    } catch (e) {
      t.push({ role: 'assistant', content: e.message || String(e), error: true })
    } finally {
      busy.value = false
    }
  }

  function clear(key) {
    delete threads.value[key]
  }

  return { threads, busy, thread, ask, clear }
})
