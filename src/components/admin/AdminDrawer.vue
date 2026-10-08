<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string; subtitle?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="#adm-layer" defer>
    <Transition name="drawer">
      <div v-if="open" class="drawer" role="dialog" :aria-label="title">
        <div class="drawer__backdrop" @click="emit('close')"></div>
        <aside class="drawer__panel" :class="{ 'drawer__panel--wide': wide }">
          <header class="drawer__head">
            <div class="drawer__titles">
              <h2 class="drawer__title">{{ title }}</h2>
              <p v-if="subtitle" class="drawer__sub">{{ subtitle }}</p>
            </div>
            <button type="button" class="drawer__close" aria-label="Закрити" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div class="drawer__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="drawer__foot">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.drawer__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(43, 43, 38, 0.32);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.drawer__panel {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  width: min(480px, calc(100% - 24px));
  border: 1px solid var(--line);
  border-radius: 26px;
  background: #fbf7ee;
  box-shadow: 0 30px 80px rgba(40, 35, 20, 0.3);
  overflow: hidden;
}

.drawer__panel--wide {
  width: min(620px, calc(100% - 24px));
}

.drawer__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 22px 22px 14px;
  border-bottom: 1px solid var(--line);
}

.drawer__title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.drawer__sub {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: var(--muted);
}

.drawer__close {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 12px;
  background: #f1ebdd;
  color: var(--ink-2);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    transform 0.25s var(--ease-out);
}

.drawer__close:hover {
  background: #e6dfcf;
  transform: rotate(90deg);
}

.drawer__close svg {
  width: 18px;
  height: 18px;
}

.drawer__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  min-height: 0;
  padding: 20px 22px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.drawer__body > * {
  flex-shrink: 0;
}

.drawer__foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--line);
  background: rgba(251, 247, 238, 0.98);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.3s ease;
}

.drawer-enter-active .drawer__panel,
.drawer-leave-active .drawer__panel {
  transition: transform 0.45s var(--ease-out);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer__panel,
.drawer-leave-to .drawer__panel {
  transform: translateX(40px);
}

@media (max-width: 720px) {
  .drawer__panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 92dvh;
    border-radius: 26px 26px 0 0;
  }

  .drawer__panel--wide {
    width: auto;
  }

  .drawer__foot {
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }

  .drawer-enter-from .drawer__panel,
  .drawer-leave-to .drawer__panel {
    transform: translateY(100%);
  }
}
</style>
