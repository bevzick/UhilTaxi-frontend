<script setup lang="ts">
import { computed } from 'vue'
import type { OrderStage } from '@/types/order'

const props = defineProps<{ stage: OrderStage }>()

const MAP: Record<OrderStage, { text: string; tone: string; live?: boolean }> = {
  searching: { text: 'Пошук водія', tone: 'amber', live: true },
  accepted: { text: 'Водій їде', tone: 'blue', live: true },
  arrived: { text: 'Водій на місці', tone: 'blue', live: true },
  started: { text: 'У дорозі', tone: 'green', live: true },
  completed: { text: 'Завершено', tone: 'grey' },
  cancelled: { text: 'Скасовано', tone: 'red' },
}

const info = computed(() => MAP[props.stage])
</script>

<template>
  <span class="a-badge" :class="[`a-badge--${info.tone}`, { 'a-badge--live': info.live }]">{{ info.text }}</span>
</template>
