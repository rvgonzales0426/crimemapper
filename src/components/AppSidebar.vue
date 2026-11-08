<script setup>
import { computed } from 'vue'
import { APP_PAGES } from '../lib/pages'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()

// Only the pages the signed-in user's role may open.
const navLinks = computed(() =>
  APP_PAGES.filter((p) => auth.canAccess(p.path)).map((p) => ({ name: p.name, to: p.path, icon: p.icon }))
)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">◬</span>
      <span class="brand-name">CRIME MAPPER</span>
    </div>

    <nav class="nav">
      <RouterLink
        v-for="link in navLinks"
        :key="link.to"
        :to="link.to"
        class="nav-link"
        active-class="active"
        :exact-active-class="link.to === '/' ? 'active' : undefined"
      >
        <span class="nav-icon">{{ link.icon }}</span>
        <span>{{ link.name }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-footer">
      <span>PNP Butuan City</span>
      <span>Police Station 4</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  height: 100%;
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--topbar-height);
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
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

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 12px;
  flex: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.nav-link.active {
  background: rgba(232, 93, 4, 0.12);
  color: var(--accent);
}

.nav-link.active .nav-icon {
  color: var(--accent);
}

.nav-icon {
  width: 20px;
  text-align: center;
  font-size: 16px;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
