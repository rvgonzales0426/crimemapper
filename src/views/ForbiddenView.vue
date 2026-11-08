<script setup>
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div class="forbidden">
    <div class="card">
      <span class="icon">⊘</span>
      <h2>No access to this page</h2>
      <p>
        Your role (<strong>{{ auth.profile?.role?.name }}</strong>) doesn't include this page. Ask an administrator if
        you need it.
      </p>
      <RouterLink :to="auth.homePath" class="back">Go to my start page</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.forbidden {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.card {
  max-width: 420px;
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.icon {
  font-size: 32px;
  color: var(--text-muted);
}

h2 {
  font-size: 18px;
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

.back {
  margin-top: 4px;
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
}
</style>
