<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import '@/assets/admin.css'
import { useAdminUi } from '@/composables/useAdminUi'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { user, logout } = useAuth()
const { toasts, dialog, settle } = useAdminUi()

const NAV = [
  { to: 'admin', label: 'Огляд', icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z' },
  { to: 'admin-orders', label: 'Замовлення', icon: 'M9 4h6l1 2h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3zM8 11h8M8 15h5' },
  { to: 'admin-clients', label: 'Клієнти', icon: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8' },
  { to: 'admin-drivers', label: 'Водії', icon: 'M5 17v-4.5L8 7h8l3 5.5V17M3 17h18M7.5 17v2M16.5 17v2M7 13h.01M17 13h.01' },
  { to: 'admin-trips', label: 'Поїздки', icon: 'M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 16h4a4 4 0 0 0 4-4V9a1 1 0 0 1 1-1h1' },
  { to: 'admin-tariffs', label: 'Тарифи', icon: 'M12 3v18M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5s2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3' },
  { to: 'admin-promocodes', label: 'Промокоди', icon: 'M20 12V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4 2 2 0 0 0 2 2h12a2 2 0 0 0 2-2 2 2 0 0 1 0-4M10 9l4 6M10 15h.01M14 9h.01' },
]

const promptValue = ref('')
const adminName = computed(() => [user.value?.first_name, user.value?.last_name].filter(Boolean).join(' ') || 'Адміністратор')
const initials = computed(() => adminName.value.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase())

watch(dialog, (value) => (promptValue.value = value?.input?.value ?? ''))

function onLogout() {
  logout()
  router.replace('/')
}

function onConfirm() {
  if (!dialog.value) return
  if (dialog.value.input) settle(promptValue.value.trim())
  else settle('')
}
</script>

<template>
  <div class="adm admin">
    <aside class="side">
      <RouterLink :to="{ name: 'admin' }" class="side__logo">
        <span class="side__mark">U</span>
        <span class="side__name">Uhil<span>Taxi</span></span>
        <span class="side__tag">Admin</span>
      </RouterLink>

      <nav class="side__nav" aria-label="Розділи адмінки">
        <RouterLink
          v-for="item in NAV"
          :key="item.to"
          :to="{ name: item.to }"
          class="side__link"
          active-class=""
          exact-active-class="side__link--active"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path :d="item.icon" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="side__me">
        <span class="side__avatar">{{ initials }}</span>
        <span class="side__who">
          <span class="side__who-name">{{ adminName }}</span>
          <span class="side__who-role">Адміністратор</span>
        </span>
        <button type="button" class="side__logout" aria-label="Вийти" title="Вийти" @click="onLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
          </svg>
        </button>
      </div>
    </aside>

    <main class="main">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.name" />
        </Transition>
      </RouterView>
    </main>

    <div id="adm-layer"></div>

    <Transition name="confirm">
      <div v-if="dialog" class="confirm" role="alertdialog" :aria-label="dialog.title">
        <div class="confirm__backdrop" @click="settle(false)"></div>
        <form class="confirm__box" @submit.prevent="onConfirm">
          <span class="confirm__icon" :class="{ 'confirm__icon--danger': dialog.danger }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="dialog.danger" d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0" />
              <path v-else d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01" />
            </svg>
          </span>
          <h2 class="confirm__title">{{ dialog.title }}</h2>
          <p class="confirm__text">{{ dialog.text }}</p>
          <label v-if="dialog.input" class="a-field confirm__field">
            <span class="a-label">{{ dialog.input.label }}</span>
            <input v-model="promptValue" class="a-input" maxlength="200" :placeholder="dialog.input.placeholder" autofocus />
          </label>
          <div class="confirm__actions">
            <button type="button" class="a-btn a-btn--ghost" @click="settle(false)">Скасувати</button>
            <button type="submit" class="a-btn" :class="dialog.danger ? 'a-btn--danger' : 'a-btn--primary'">{{ dialog.action }}</button>
          </div>
        </form>
      </div>
    </Transition>

    <TransitionGroup name="toast" tag="div" class="toasts" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.tone}`" role="status">
        <svg v-if="toast.tone === 'ok'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 8v5M12 16h.01" /></svg>
        {{ toast.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--bg);
}

.side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
  height: 100dvh;
  padding: 22px 16px 16px;
  background: #23231f;
  color: #d9d3c4;
}

.side__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  text-decoration: none;
}

.side__mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--green);
  color: #fbf7ee;
  font-size: 19px;
  font-weight: 700;
}

.side__name {
  font-size: 20px;
  font-weight: 700;
  color: #fbf7ee;
}

.side__name span {
  color: var(--mint);
}

.side__tag {
  padding: 3px 7px;
  border-radius: 7px;
  background: rgba(143, 209, 171, 0.14);
  color: var(--mint);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.side__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.side__link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 46px;
  padding: 0 14px;
  border-radius: 14px;
  color: #b8b2a2;
  font-size: 14.5px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.side__link:hover {
  background: rgba(251, 247, 238, 0.06);
  color: #fbf7ee;
}

.side__link svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.side__link--active {
  background: rgba(143, 209, 171, 0.12);
  color: #fbf7ee;
}

.side__link--active::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--mint);
}

.side__link--active svg {
  color: var(--mint);
}

.side__me {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(251, 247, 238, 0.05);
}

.side__avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, #2f7d57, #5aa57d);
  color: #fbf7ee;
  font-size: 14px;
  font-weight: 700;
}

.side__who {
  flex: 1;
  min-width: 0;
}

.side__who-name {
  display: block;
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  color: #fbf7ee;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.side__who-role {
  display: block;
  font-size: 12px;
  color: #8a8578;
}

.side__logout {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 11px;
  background: transparent;
  color: #b8b2a2;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.side__logout:hover {
  background: rgba(251, 234, 230, 0.12);
  color: #f2b3a6;
}

.side__logout svg {
  width: 18px;
  height: 18px;
}

.main {
  min-width: 0;
  padding: 32px 36px 48px;
}

.confirm {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 16px;
}

.confirm__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(43, 43, 38, 0.4);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.confirm__box {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(420px, 100%);
  padding: 28px 24px 22px;
  border-radius: 26px;
  background: #fbf7ee;
  box-shadow: 0 30px 80px rgba(40, 35, 20, 0.35);
  text-align: center;
}

.confirm__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
  border-radius: 18px;
  background: var(--green-soft);
  color: var(--green);
}

.confirm__icon--danger {
  background: var(--red-soft);
  color: var(--red);
}

.confirm__icon svg {
  width: 26px;
  height: 26px;
}

.confirm__title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
}

.confirm__text {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--muted);
}

.confirm__field {
  width: 100%;
  margin-top: 16px;
  text-align: left;
}

.confirm__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
  margin-top: 20px;
}

.toasts {
  position: fixed;
  top: 20px;
  left: 50%;
  z-index: 3100;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 380px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--ink);
  color: #fbf7ee;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.25);
}

.toast svg {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--mint);
}

.toast--error {
  background: #7d2c1e;
}

.toast--error svg {
  color: #f6c1b6;
}

.page-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.35s var(--ease-out);
}

.page-leave-active {
  transition: opacity 0.12s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-enter-active .confirm__box {
  transition: transform 0.35s cubic-bezier(0.34, 1.4, 0.5, 1);
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}

.confirm-enter-from .confirm__box {
  transform: scale(0.94);
}

.toast-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.4s var(--ease-out);
}

.toast-leave-active {
  transition: opacity 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.toast-leave-to {
  opacity: 0;
}

@media (max-width: 960px) {
  .admin {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    position: sticky;
    top: 0;
    z-index: 100;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    height: auto;
    padding: 10px 12px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .side::-webkit-scrollbar {
    display: none;
  }

  .side__name,
  .side__tag,
  .side__who {
    display: none;
  }

  .side__nav {
    flex-direction: row;
    gap: 2px;
  }

  .side__link {
    height: 40px;
    padding: 0 12px;
    font-size: 13.5px;
    white-space: nowrap;
  }

  .side__link--active::before {
    top: auto;
    bottom: 0;
    left: 12px;
    right: 12px;
    width: auto;
    height: 3px;
    border-radius: 3px 3px 0 0;
  }

  .side__me {
    padding: 0;
    background: none;
  }

  .side__avatar {
    display: none;
  }

  .main {
    padding: 20px 14px 40px;
  }

  .toasts {
    top: 64px;
    left: 14px;
    right: 14px;
    align-items: stretch;
    transform: none;
  }
}
</style>
