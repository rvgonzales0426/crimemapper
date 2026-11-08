<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <section class="placeholder">
    <div class="placeholder-card">
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <span class="badge">Coming soon</span>
    </div>
  </section>
</template>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.placeholder-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  max-width: 480px;
}

.placeholder-card h2 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 8px;
}

.placeholder-card p {
  color: var(--text-muted);
  margin-bottom: 20px;
}

.badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(232, 93, 4, 0.12);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
</style>
