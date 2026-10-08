import { computed, onBeforeUnmount, ref } from 'vue'
import { ApiError } from '@/api/http'
import { ordersApi } from '@/api/orders'
import { isFinal } from '@/utils/order'
import type { CreateOrderRequest, OrderView } from '@/types/order'

const STORAGE_KEY = 'uhiltaxi.active-order'
const POLL_MS = 4000
const REJECT_REASON = 'Клієнт відхилив водія'
const MAX_REJECTS = 5

interface Saved {
  id: number
  request: CreateOrderRequest
  confirmedDriverId: number | null
  rejects: number
}

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Saved>
    if (typeof value.id !== 'number' || !value.request || typeof value.request !== 'object') return null
    return {
      id: value.id,
      request: value.request,
      confirmedDriverId: typeof value.confirmedDriverId === 'number' ? value.confirmedDriverId : null,
      rejects: typeof value.rejects === 'number' ? value.rejects : 0,
    }
  } catch {
    return null
  }
}

function write(value: Saved | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}

/**
 * Tracks the client's current order by polling the API. The backend has no "reject driver" endpoint,
 * so rejecting cancels the order and immediately re-creates the same request to keep searching.
 */
export function useActiveOrder() {
  const saved = ref<Saved | null>(read())
  const order = ref<OrderView | null>(null)
  const busy = ref(false)
  const error = ref('')
  const researching = ref(false)
  let timer = 0
  let stopped = false

  const confirmed = computed(
    () => !!order.value && order.value.driverId !== null && saved.value?.confirmedDriverId === order.value.driverId,
  )

  /** Driver accepted but the client hasn't decided yet; once the driver arrives the choice is moot. */
  const needsDecision = computed(() => order.value?.stage === 'accepted' && !confirmed.value)

  function persist(patch: Partial<Saved>) {
    if (!saved.value) return
    saved.value = { ...saved.value, ...patch }
    write(saved.value)
  }

  function schedule() {
    clearTimeout(timer)
    if (stopped || !saved.value || (order.value && isFinal(order.value.stage))) return
    timer = window.setTimeout(poll, POLL_MS)
  }

  async function poll() {
    if (!saved.value) return
    try {
      const next = await ordersApi.get(saved.value.id)
      order.value = next
      if (next.stage !== 'searching') researching.value = false
      error.value = ''
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        clear()
        return
      }
      error.value = "Немає зв'язку з сервером, пробуємо ще раз…"
    }
    schedule()
  }

  function start(created: OrderView, request: CreateOrderRequest) {
    saved.value = { id: created.id, request, confirmedDriverId: null, rejects: 0 }
    write(saved.value)
    order.value = created
    error.value = ''
    schedule()
  }

  function confirmDriver() {
    if (order.value?.driverId) persist({ confirmedDriverId: order.value.driverId })
  }

  async function run(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    clearTimeout(timer)
    try {
      await action()
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Не вдалося виконати дію. Спробуйте ще раз'
    } finally {
      busy.value = false
      schedule()
    }
  }

  const rejectDriver = () =>
    run(async () => {
      if (!saved.value || !order.value) return
      if (saved.value.rejects >= MAX_REJECTS) {
        error.value = 'Забагато відмов поспіль. Скасуйте замовлення або підтвердіть водія'
        return
      }
      await ordersApi.cancel(order.value.id, REJECT_REASON)
      const again = await ordersApi.create(saved.value.request)
      persist({ id: again.id, confirmedDriverId: null, rejects: saved.value.rejects + 1 })
      order.value = again
      researching.value = true
    })

  const cancel = (reason = 'Скасовано клієнтом') =>
    run(async () => {
      if (!order.value) return
      order.value = await ordersApi.cancel(order.value.id, reason)
    })

  function clear() {
    clearTimeout(timer)
    saved.value = null
    order.value = null
    researching.value = false
    error.value = ''
    write(null)
  }

  if (saved.value) poll()

  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })

  return {
    order,
    busy,
    error,
    researching,
    confirmed,
    needsDecision,
    hasActive: computed(() => !!saved.value),
    rejects: computed(() => saved.value?.rejects ?? 0),
    start,
    confirmDriver,
    rejectDriver,
    cancel,
    clear,
  }
}
