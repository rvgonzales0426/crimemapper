<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const auth = useAuthStore()
const pageTitle = computed(() => route.meta.title || 'Crime Mapper')
</script>

<template>
  <header class="topbar">
    <h1 class="page-title">{{ pageTitle }}</h1>

    <div class="user">
      <div class="user-meta">
        <span class="user-name">{{ auth.displayName }}</span>
        <span class="user-role">{{ auth.profile?.role?.name ?? 'No role' }}</span>
      </div>
      <div class="avatar" aria-hidden="true">{{ auth.initials }}</div>
      <button class="signout" @click="auth.signOut()">Sign out</button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--topbar-height);
  flex-shrink: 0;
  background: var(--sidebar);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.user-role {
  font-size: 11px;
  color: var(--text-muted);
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
}

.signout {
  margin-left: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.signout:hover {
  color: var(--accent);
  border-color: var(--accent);
}
</style>
