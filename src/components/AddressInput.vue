<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isAbort, searchAddress } from '@/api/geocode'
import { clean } from '@/utils/validation'
import type { GeoSuggestion, Place } from '@/types/geo'

const MAX_LENGTH = 120
const DEBOUNCE_MS = 450

const props = defineProps<{
  modelValue: Place | null
  label: string
  placeholder: string
  variant: 'from' | 'to'
  inputId: string
  invalid?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Place | null] }>()

const input = ref<HTMLInputElement | null>(null)
const text = ref(props.modelValue?.address ?? '')
const dirty = ref(false)
const focused = ref(false)
const open = ref(false)
const loading = ref(false)
const searched = ref(false)
const items = ref<GeoSuggestion[]>([])
const active = ref(-1)

let timer = 0
let blurTimer = 0
let controller: AbortController | null = null

const listId = computed(() => `${props.inputId}-list`)
const isMe = computed(() => props.modelValue?.source === 'me' && !dirty.value)
const pending = computed(() => props.modelValue?.pending === true && !dirty.value)
const showList = computed(() => open.value && (loading.value || searched.value))

watch(
  () => props.modelValue,
  (value) => {
    if (!dirty.value) text.value = value?.address ?? ''
  },
)

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(blurTimer)
  controller?.abort()
})

function onInput() {
  if (text.value.length > MAX_LENGTH) text.value = text.value.slice(0, MAX_LENGTH)
  dirty.value = true
  clearTimeout(timer)
  controller?.abort()

  const query = clean(text.value).trim()
  if (query.length < 3) {
    items.value = []
    searched.value = false
    loading.value = false
    open.value = false
    return
  }

  loading.value = true
  open.value = true
  timer = window.setTimeout(() => run(query), DEBOUNCE_MS)
}

async function run(query: string) {
  controller = new AbortController()
  try {
    items.value = await searchAddress(query, controller.signal)
    active.value = items.value.length ? 0 : -1
    searched.value = true
    loading.value = false
  } catch (error) {
    if (isAbort(error)) return
    items.value = []
    searched.value = true
    loading.value = false
  }
}

function choose(item: GeoSuggestion) {
  emit('update:modelValue', { lat: item.lat, lng: item.lng, address: item.address, source: 'search' })
  text.value = item.address
  dirty.value = false
  open.value = false
  items.value = []
  searched.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (!showList.value || !items.value.length) {
    if (event.key === 'Escape' && dirty.value) restore()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = (active.value + 1) % items.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = (active.value - 1 + items.value.length) % items.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = items.value[active.value]
    if (item) choose(item)
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    open.value = false
  }
}

function restore() {
  text.value = props.modelValue?.address ?? ''
  dirty.value = false
  open.value = false
}

function onFocus() {
  clearTimeout(blurTimer)
  focused.value = true
  if (items.value.length) open.value = true
}

function onBlur() {
  focused.value = false
  blurTimer = window.setTimeout(() => {
    open.value = false
    if (dirty.value) restore()
  }, 160)
}

function clear() {
  clearTimeout(timer)
  controller?.abort()
  text.value = ''
  dirty.value = false
  items.value = []
  searched.value = false
  open.value = false
  emit('update:modelValue', null)
  input.value?.focus()
}
</script>

<template>
  <div
    class="addr"
    :class="[`addr--${variant}`, { 'addr--focused': focused, 'addr--invalid': invalid, 'addr--open': showList }]"
  >
    <span class="addr__marker" aria-hidden="true"></span>

    <label class="addr__label" :for="inputId">{{ label }}</label>

    <div class="addr__control">
      <input
        :id="inputId"
        ref="input"
        v-model="text"
        class="addr__input"
        type="text"
        role="combobox"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :maxlength="MAX_LENGTH"
        :placeholder="pending ? 'Визначаємо адресу…' : placeholder"
        :aria-expanded="showList"
        :aria-controls="listId"
        :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />

      <span v-if="pending || loading" class="addr__spinner" aria-hidden="true"></span>
      <span v-else-if="isMe" class="addr__badge">Ви тут</span>
      <button
        v-else-if="text"
        type="button"
        class="addr__clear"
        aria-label="Очистити"
        @mousedown.prevent
        @click="clear"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <Transition name="drop">
      <ul v-if="showList" :id="listId" class="addr__list" role="listbox">
        <li v-if="loading && !items.length" class="addr__state">
          <span class="addr__skeleton"></span>
          <span class="addr__skeleton addr__skeleton--short"></span>
        </li>
        <li v-else-if="!items.length" class="addr__state">Нічого не знайдено в межах Хмельницького</li>
        <li
          v-for="(item, index) in items"
          :id="`${listId}-${index}`"
          :key="item.id"
          class="addr__item"
          :class="{ 'addr__item--active': index === active }"
          role="option"
          :aria-selected="index === active"
          :style="{ '--i': index }"
          @mousedown.prevent
          @mouseenter="active = index"
          @click="choose(item)"
        >
          <span class="addr__item-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
          </span>
          <span class="addr__item-text">
            <span class="addr__item-title">{{ item.title }}</span>
            <span class="addr__item-sub">{{ item.subtitle }}</span>
          </span>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.addr {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  padding: 10px 14px 10px 44px;
  border: 1.5px solid #e6dfcf;
  border-radius: 16px;
  background: #fffdf8;
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease,
    background-color 0.2s ease;
}

.addr--focused {
  border-color: #2f7d57;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(47, 125, 87, 0.12);
}

.addr--invalid {
  border-color: #c2543f;
}

.addr--open {
  z-index: 5;
}

.addr__marker {
  position: absolute;
  top: 50%;
  left: 16px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  transform: translateY(-50%);
}

.addr--from .addr__marker {
  border: 4px solid #2f7d57;
  background: #ffffff;
}

.addr--to .addr__marker {
  border-radius: 4px;
  background: #2b2b26;
  transform: translateY(-50%) rotate(45deg) scale(0.85);
}

.addr__label {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 600;
  color: #8a8578;
  letter-spacing: 0.02em;
  cursor: text;
}

.addr__control {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.addr__input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #2b2b26;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  outline: none;
  text-overflow: ellipsis;
}

.addr__input::placeholder {
  color: #b5ae9f;
  font-weight: 400;
}

.addr__badge {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: #e3efe7;
  color: #2f7d57;
  font-size: 12px;
  font-weight: 600;
}

.addr__spinner {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 2px solid #e3efe7;
  border-top-color: #2f7d57;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.addr__clear {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #f1ebdd;
  color: #8a8578;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--ease-out);
}

.addr__clear:hover {
  background: #e6dfcf;
  color: #2b2b26;
  transform: rotate(90deg);
}

.addr__clear svg {
  width: 12px;
  height: 12px;
}

.addr__list {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  max-height: 290px;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  border: 1px solid #ece5d6;
  border-radius: 16px;
  background: #fffdf8;
  box-shadow: 0 20px 44px rgba(60, 50, 30, 0.16);
  list-style: none;
  overscroll-behavior: contain;
}

.addr__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 12px;
  cursor: pointer;
  animation: item-in 0.3s calc(var(--i) * 35ms) var(--ease-out) backwards;
  transition: background-color 0.15s ease;
}

.addr__item--active {
  background: #f1ebdd;
}

.addr__item-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #e3efe7;
  color: #2f7d57;
  transition: transform 0.2s var(--ease-out);
}

.addr__item--active .addr__item-icon {
  transform: scale(1.08);
}

.addr__item-icon svg {
  width: 18px;
  height: 18px;
}

.addr__item-text {
  min-width: 0;
}

.addr__item-title,
.addr__item-sub {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.addr__item-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #2b2b26;
}

.addr__item-sub {
  margin-top: 1px;
  font-size: 12.5px;
  color: #8a8578;
}

.addr__state {
  padding: 14px 12px;
  font-size: 14px;
  color: #8a8578;
}

.addr__skeleton {
  display: block;
  height: 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: linear-gradient(90deg, #f1ebdd 25%, #f8f4ea 50%, #f1ebdd 75%);
  background-size: 200% 100%;
  animation: shimmer 1.1s linear infinite;
}

.addr__skeleton--short {
  width: 60%;
  margin-bottom: 0;
}

.drop-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.25s var(--ease-out);
}

.drop-leave-active {
  transition: opacity 0.12s ease;
}

.drop-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.drop-leave-to {
  opacity: 0;
}

@keyframes item-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>