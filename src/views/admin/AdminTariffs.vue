<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AdminDrawer from '@/components/admin/AdminDrawer.vue'
import { adminApi } from '@/api/admin'
import { useAdminUi } from '@/composables/useAdminUi'
import { formatFare } from '@/utils/order'
import { clean } from '@/utils/validation'
import type { AdminTariff, TariffRequest } from '@/types/admin'

const SAMPLE = { km: 5, min: 12 }
const CLASSES = ['economy', 'comfort', 'business', 'minivan', 'premium']
const MAX_MONEY = 99_999_999.99

const { notify, failMessage } = useAdminUi()

const tariffs = ref<AdminTariff[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busyId = ref<number | null>(null)

const formOpen = ref(false)
const editing = ref<AdminTariff | null>(null)
const f = reactive({ name: '', serviceClass: 'economy', baseFare: '', ratePerKm: '', ratePerMin: '' })
const touched = ref(false)
const saving = ref(false)
const formError = ref('')

const priceFor = (t: { baseFare: number; ratePerKm: number; ratePerMin: number }, km = SAMPLE.km, min = SAMPLE.min) =>
  t.baseFare + t.ratePerKm * km + t.ratePerMin * min

const sorted = computed(() => [...tariffs.value].sort((a, b) => Number(b.active) - Number(a.active) || priceFor(a) - priceFor(b)))
const money = (value: string) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= MAX_MONEY ? Math.round(n * 100) / 100 : null
}

const errors = computed(() => ({
  name: !clean(f.name).trim() ? 'Вкажіть назву' : clean(f.name).trim().length > 50 ? 'Максимум 50 символів' : null,
  serviceClass: !clean(f.serviceClass).trim() ? 'Вкажіть клас' : null,
  baseFare: money(f.baseFare) === null ? 'Число від 0' : null,
  ratePerKm: money(f.ratePerKm) === null ? 'Число від 0' : null,
  ratePerMin: money(f.ratePerMin) === null ? 'Число від 0' : null,
}))
const show = (key: keyof typeof errors.value) => (touched.value ? errors.value[key] : null)

const preview = computed(() => {
  const t = { baseFare: money(f.baseFare) ?? 0, ratePerKm: money(f.ratePerKm) ?? 0, ratePerMin: money(f.ratePerMin) ?? 0 }
  return [
    { label: 'Коротка · 2 км', value: priceFor(t, 2, 6) },
    { label: 'Середня · 5 км', value: priceFor(t, 5, 12) },
    { label: 'Довга · 12 км', value: priceFor(t, 12, 25) },
  ]
})

async function load() {
  try {
    tariffs.value = await adminApi.tariffs()
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

function openForm(tariff: AdminTariff | null) {
  editing.value = tariff
  f.name = tariff?.name ?? ''
  f.serviceClass = tariff?.serviceClass || 'economy'
  f.baseFare = tariff ? String(tariff.baseFare) : ''
  f.ratePerKm = tariff ? String(tariff.ratePerKm) : ''
  f.ratePerMin = tariff ? String(tariff.ratePerMin) : ''
  touched.value = false
  formError.value = ''
  formOpen.value = true
}

async function save() {
  touched.value = true
  if (Object.values(errors.value).some(Boolean)) return
  const body: TariffRequest = {
    name: clean(f.name).replace(/\s+/g, ' ').trim(),
    service_class: clean(f.serviceClass).trim().toLowerCase(),
    base_fare: money(f.baseFare)!,
    rate_per_km: money(f.ratePerKm)!,
    rate_per_min: money(f.ratePerMin)!,
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      const updated = await adminApi.updateTariff(editing.value.id, body)
      tariffs.value = tariffs.value.map((item) => (item.id === updated.id ? updated : item))
      notify(`Тариф «${updated.name}» оновлено`)
    } else {
      const created = await adminApi.createTariff(body)
      tariffs.value = [...tariffs.value, created]
      notify(`Тариф «${created.name}» створено`)
    }
    formOpen.value = false
  } catch (e) {
    formError.value = failMessage(e, 'Не вдалося зберегти тариф')
  } finally {
    saving.value = false
  }
}

async function toggle(tariff: AdminTariff) {
  busyId.value = tariff.id
  try {
    const updated = await adminApi.setTariffActive(tariff.id, !tariff.active)
    tariffs.value = tariffs.value.map((item) => (item.id === tariff.id ? { ...updated, active: !tariff.active } : item))
    notify(!tariff.active ? `«${tariff.name}» доступний клієнтам` : `«${tariff.name}» приховано від клієнтів`)
  } catch (e) {
    notify(failMessage(e), 'error')
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="a-page">
    <header class="a-head">
      <div>
        <h1 class="a-title">Тарифи</h1>
        <p class="a-sub">Ціна поїздки = посадка + км × ставка + хв × ставка</p>
      </div>
      <button type="button" class="a-btn a-btn--primary" @click="openForm(null)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Новий тариф
      </button>
    </header>

    <div v-if="state === 'loading'" class="grid">
      <span v-for="n in 3" :key="n" class="a-skeleton" style="height: 260px; border-radius: 22px"></span>
    </div>
    <div v-else-if="!sorted.length" class="a-card a-empty">
      <strong>{{ state === 'error' ? 'Не вдалося завантажити тарифи' : 'Тарифів ще немає' }}</strong>
      <span v-if="state !== 'error'">Створіть перший тариф, щоб клієнти могли замовляти поїздки</span>
    </div>

    <div v-else class="grid">
      <article v-for="tariff in sorted" :key="tariff.id" class="a-card tariff" :class="{ 'tariff--off': !tariff.active }">
        <header class="tariff__head">
          <div>
            <p class="tariff__class">{{ tariff.serviceClass || 'клас не вказано' }}</p>
            <h2 class="tariff__name">{{ tariff.name }}</h2>
          </div>
          <button
            type="button"
            class="a-switch"
            :class="{ 'a-switch--on': tariff.active }"
            role="switch"
            :aria-checked="tariff.active"
            :aria-label="tariff.active ? 'Вимкнути тариф' : 'Увімкнути тариф'"
            :disabled="busyId === tariff.id"
            @click="toggle(tariff)"
          ></button>
        </header>

        <div class="tariff__sample">
          <span class="tariff__sample-label">Поїздка {{ SAMPLE.km }} км · {{ SAMPLE.min }} хв</span>
          <span class="tariff__sample-value">{{ formatFare(priceFor(tariff)) }}</span>
        </div>

        <dl class="tariff__rates">
          <div><dt>Посадка</dt><dd>{{ formatFare(tariff.baseFare) }}</dd></div>
          <div><dt>За км</dt><dd>{{ tariff.ratePerKm.toFixed(2).replace('.', ',') }} ₴</dd></div>
          <div><dt>За хв</dt><dd>{{ tariff.ratePerMin.toFixed(2).replace('.', ',') }} ₴</dd></div>
        </dl>

        <footer class="tariff__foot">
          <span class="a-badge" :class="tariff.active ? 'a-badge--green' : 'a-badge--grey'">{{ tariff.active ? 'Доступний клієнтам' : 'Вимкнено' }}</span>
          <button type="button" class="a-btn a-btn--ghost a-btn--sm" @click="openForm(tariff)">Редагувати</button>
        </footer>
      </article>
    </div>

    <AdminDrawer :open="formOpen" :title="editing ? `Тариф «${editing.name}»` : 'Новий тариф'" subtitle="Зміни діятимуть для нових замовлень" @close="formOpen = false">
      <form class="form" novalidate @submit.prevent="save">
        <div class="a-grid">
          <label class="a-field">
            <span class="a-label">Назва</span>
            <input v-model="f.name" class="a-input" :class="{ 'a-input--invalid': show('name') }" maxlength="50" placeholder="Comfort" />
            <span v-if="show('name')" class="a-error">{{ show('name') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">Клас обслуговування</span>
            <input v-model="f.serviceClass" class="a-input" list="tariff-classes" :class="{ 'a-input--invalid': show('serviceClass') }" maxlength="30" />
            <datalist id="tariff-classes">
              <option v-for="item in CLASSES" :key="item" :value="item" />
            </datalist>
            <span v-if="show('serviceClass')" class="a-error">{{ show('serviceClass') }}</span>
          </label>
        </div>
        <div class="a-grid a-grid--3">
          <label class="a-field">
            <span class="a-label">Посадка, ₴</span>
            <input v-model="f.baseFare" class="a-input" :class="{ 'a-input--invalid': show('baseFare') }" inputmode="decimal" placeholder="65" />
            <span v-if="show('baseFare')" class="a-error">{{ show('baseFare') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">За км, ₴</span>
            <input v-model="f.ratePerKm" class="a-input" :class="{ 'a-input--invalid': show('ratePerKm') }" inputmode="decimal" placeholder="18" />
            <span v-if="show('ratePerKm')" class="a-error">{{ show('ratePerKm') }}</span>
          </label>
          <label class="a-field">
            <span class="a-label">За хв, ₴</span>
            <input v-model="f.ratePerMin" class="a-input" :class="{ 'a-input--invalid': show('ratePerMin') }" inputmode="decimal" placeholder="3" />
            <span v-if="show('ratePerMin')" class="a-error">{{ show('ratePerMin') }}</span>
          </label>
        </div>

        <section class="preview">
          <p class="preview__title">Так клієнти побачать ціну</p>
          <div class="preview__rows">
            <div v-for="row in preview" :key="row.label" class="preview__row">
              <span>{{ row.label }}</span>
              <strong>{{ formatFare(row.value) }}</strong>
            </div>
          </div>
        </section>

        <p v-if="formError" class="a-alert">{{ formError }}</p>
        <button type="submit" hidden></button>
      </form>
      <template #footer>
        <button type="button" class="a-btn a-btn--ghost" @click="formOpen = false">Скасувати</button>
        <button type="button" class="a-btn a-btn--primary" :disabled="saving" @click="save">
          <span v-if="saving" class="a-spinner"></span>
          <template v-else>{{ editing ? 'Зберегти' : 'Створити тариф' }}</template>
        </button>
      </template>
    </AdminDrawer>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.tariff {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
}

.tariff--off {
  opacity: 0.65;
}

.tariff__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.tariff__class {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--green);
}

.tariff__name {
  margin: 2px 0 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.tariff__sample {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  border-radius: 18px;
  background: var(--ink);
  color: #fbf7ee;
}

.tariff--off .tariff__sample {
  background: #8a8578;
}

.tariff__sample-label {
  font-size: 12.5px;
  color: #b8b2a2;
}

.tariff__sample-value {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.tariff__rates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.tariff__rates dt {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.tariff__rates dd {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}

.tariff__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview {
  padding: 16px;
  border-radius: 18px;
  background: var(--ink);
  color: #fbf7ee;
}

.preview__title {
  margin: 0 0 10px;
  font-size: 13px;
  color: #b8b2a2;
}

.preview__rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview__row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.preview__row strong {
  font-size: 16px;
}
</style>
