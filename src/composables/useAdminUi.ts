import { ref } from 'vue'
import { ApiError } from '@/api/http'

export interface ConfirmRequest {
  title: string
  text: string
  action: string
  danger?: boolean
  /** When set, the dialog shows a text field and passes its value to the promise. */
  input?: { label: string; placeholder?: string; value?: string }
}

interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

// Module-level singletons: AdminView renders them once, every admin page can raise them.
const toasts = ref<Toast[]>([])
const dialog = ref<(ConfirmRequest & { resolve: (value: string | false) => void }) | null>(null)
let seq = 0

function notify(text: string, tone: Toast['tone'] = 'ok') {
  const id = ++seq
  toasts.value = [...toasts.value.slice(-2), { id, text, tone }]
  window.setTimeout(() => (toasts.value = toasts.value.filter((toast) => toast.id !== id)), 3600)
}

const failMessage = (error: unknown, fallback = 'Не вдалося виконати дію') =>
  error instanceof ApiError ? error.message : fallback

/** Resolves to the typed text (or '' without an input) on confirm, or false on cancel. */
function confirm(request: ConfirmRequest): Promise<string | false> {
  dialog.value?.resolve(false)
  return new Promise((resolve) => {
    dialog.value = { ...request, resolve }
  })
}

function settle(value: string | false) {
  dialog.value?.resolve(value)
  dialog.value = null
}

export function useAdminUi() {
  return { toasts, dialog, notify, confirm, settle, failMessage }
}
