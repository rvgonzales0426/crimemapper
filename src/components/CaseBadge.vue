<script setup>
import { computed } from 'vue'
import { PRIORITIES, STATUSES } from '../stores/investigations'

// Case status or priority pill. Always carries its text label.
const props = defineProps({
  kind: { type: String, default: 'status' }, // 'status' | 'priority'
  value: { type: String, required: true },
})

const label = computed(
  () => (props.kind === 'status' ? STATUSES : PRIORITIES).find((s) => s.value === props.value)?.label ?? props.value
)
</script>

<template>
  <span class="case-badge" :class="`${kind}-${value}`">{{ label }}</span>
</template>

<style scoped>
.case-badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.status-open {
  background: rgba(57, 135, 229, 0.15);
  color: #6da7ec;
}

.status-active {
  background: rgba(25, 158, 112, 0.15);
  color: #4cc59a;
}

.status-suspended {
  background: rgba(217, 164, 38, 0.15);
  color: #e0b54a;
}

.status-closed {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.priority-critical {
  background: rgba(248, 81, 73, 0.15);
  color: #f8716a;
}

.priority-high {
  background: rgba(217, 89, 38, 0.15);
  color: #e8834f;
}

.priority-medium {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.priority-low {
  background: transparent;
  color: var(--text-muted);
}
</style>
