<script setup>
import { useRoute } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'

const route = useRoute()
</script>

<template>
  <!-- Sign-in / approval screens render full-page, without the shell. -->
  <RouterView v-if="route.meta.bare" />
  <div v-else class="layout">
    <AppSidebar />
    <div class="main">
      <AppTopbar />
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  height: 100%;
}

.main {
  margin-left: var(--sidebar-width);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
</style>
