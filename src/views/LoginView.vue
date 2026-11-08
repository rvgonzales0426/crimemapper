<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

// Self sign-up ("Request access") is off unless VITE_ALLOW_SIGNUP=true.
const allowSignup = import.meta.env.VITE_ALLOW_SIGNUP === 'true'

const mode = ref('signin') // 'signin' | 'request'
const email = ref('')
const password = ref('')
const fullName = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')

function switchMode(m) {
  mode.value = m
  error.value = ''
  notice.value = ''
}

// Only follow same-app paths from ?redirect=.
function redirectTarget() {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : null
}

async function submit() {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    if (mode.value === 'signin') {
      await auth.signIn(email.value.trim(), password.value)
      router.replace(auth.hasAccess ? redirectTarget() || auth.homePath : '/pending')
    } else {
      const { needsConfirmation } = await auth.signUp(email.value.trim(), password.value, fullName.value.trim())
      if (needsConfirmation) {
        switchMode('signin')
        notice.value =
          'Request sent. Confirm your email from the link we sent you; an administrator then approves your account.'
      } else {
        router.replace('/pending')
      }
    }
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <RouterLink to="/welcome" class="back">← Crime Mapper front page</RouterLink>
    <form class="auth-card" @submit.prevent="submit">
      <div class="brand">
        <span class="brand-mark">◬</span>
        <span class="brand-name">CRIME MAPPER</span>
      </div>
      <p class="station">PNP Butuan City · Police Station 4</p>

      <h1>{{ mode === 'signin' ? 'Sign in' : 'Request access' }}</h1>

      <label v-if="mode === 'request'">
        <span>Full name</span>
        <input v-model="fullName" type="text" autocomplete="name" required />
      </label>
      <label>
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label>
        <span>Password</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
          :minlength="mode === 'request' ? 8 : undefined"
          required
        />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>

      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Request access' }}
      </button>

      <p v-if="allowSignup" class="switch">
        <template v-if="mode === 'signin'">
          New to Crime Mapper?
          <button type="button" class="link" @click="switchMode('request')">Request access</button>
        </template>
        <template v-else>
          Already approved?
          <button type="button" class="link" @click="switchMode('signin')">Sign in</button>
        </template>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: var(--bg);
}

.back {
  width: 100%;
  max-width: 380px;
  font-size: 13px;
  color: var(--text-muted);
}

.back:hover {
  color: var(--accent);
}

.auth-card {
  width: 100%;
  max-width: 380px;
  background: var(--sidebar);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  color: var(--accent);
  font-size: 22px;
  line-height: 1;
}

.brand-name {
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--text);
}

.station {
  margin-top: -8px;
  font-size: 12px;
  color: var(--text-muted);
}

h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin-top: 6px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

input {
  padding: 9px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
}

input:focus {
  outline: none;
  border-color: var(--accent);
}

.primary {
  margin-top: 4px;
  padding: 10px;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  font-size: 13px;
  color: #f85149;
}

.notice {
  font-size: 13px;
  color: var(--text);
  background: rgba(57, 135, 229, 0.12);
  border: 1px solid rgba(57, 135, 229, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.5;
}

.switch {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}
</style>
