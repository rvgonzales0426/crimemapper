<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const checking = ref(false)

const deactivated = computed(() => auth.profile && auth.profile.role && !auth.profile.active)

async function checkAgain() {
  checking.value = true
  await auth.loadProfile()
  checking.value = false
  if (auth.hasAccess) router.replace(auth.homePath)
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand">
        <span class="brand-mark">◬</span>
        <span class="brand-name">CRIME MAPPER</span>
      </div>

      <h1>{{ deactivated ? 'Account deactivated' : 'Awaiting approval' }}</h1>
      <p v-if="deactivated">
        Your account has been deactivated. Contact the station administrator if you need access restored.
      </p>
      <p v-else>
        You're signed in as <strong>{{ auth.user?.email }}</strong>, but no role has been assigned yet. An
        administrator needs to approve your account on the Admin page.
      </p>
      <p v-if="auth.profileError" class="error">Couldn't load your profile: {{ auth.profileError }}</p>

      <div class="actions">
        <button class="primary" :disabled="checking" @click="checkAgain">
          {{ checking ? 'Checking…' : 'Check again' }}
        </button>
        <button class="secondary" @click="auth.signOut()">Sign out</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
}

.auth-card {
  width: 100%;
  max-width: 420px;
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

h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-muted);
}

strong {
  color: var(--text);
}

.error {
  color: #f85149;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 10px;
}

.actions button {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.primary {
  background: var(--accent);
  border: none;
  color: #fff;
}

.primary:disabled {
  opacity: 0.6;
}

.secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.secondary:hover {
  color: var(--text);
}
</style>
