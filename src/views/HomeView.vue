<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, reactive } from 'vue'

type Pt = [number, number]
type Phase = 'waiting' | 'fadeIn' | 'drive' | 'arrived' | 'fadeOut'

interface Line {
  pts: Pt[]
  cum: number[]
  len: number
}

interface Car {
  line: Line
  s: number
  v: number
  vmax: number
  prio: number
  scale: number
  color: string
  loop: boolean
  active: boolean
  opacity: number
  stopped: number
  x: number
  y: number
  a: number
}

const LANE = 4.5
const LOOK = 46
const GAP = 24
const ACC = 30
const DEC = 90
const TAXI_BRAKE = 30
const FADE = 0.6
const PAUSE = 1.6

const pt = (arr: Pt[], i: number) => arr[i] as Pt
const num = (arr: number[], i: number) => arr[i] as number

function spline(ctrl: Pt[], steps = 14): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = pt(ctrl, Math.max(i - 1, 0))
    const p1 = pt(ctrl, i)
    const p2 = pt(ctrl, i + 1)
    const p3 = pt(ctrl, Math.min(i + 2, ctrl.length - 1))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(pt(ctrl, ctrl.length - 1))
  return out
}

function makeLine(pts: Pt[]): Line {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pt(pts, i - 1)
    const b = pt(pts, i)
    cum.push(num(cum, i - 1) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return { pts, cum, len: num(cum, cum.length - 1) }
}

function locate(line: Line, s: number) {
  const d = Math.min(Math.max(s, 0), line.len)
  let lo = 0
  let hi = line.cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (num(line.cum, mid) <= d) lo = mid
    else hi = mid
  }
  const a = pt(line.pts, lo)
  const b = pt(line.pts, hi)
  const seg = num(line.cum, hi) - num(line.cum, lo) || 1
  const t = (d - num(line.cum, lo)) / seg
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    a: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
  }
}

function slice(line: Line, s0: number, s1: number): Pt[] {
  const lo = Math.min(s0, s1)
  const hi = Math.max(s0, s1)
  const at = (s: number): Pt => {
    const l = locate(line, s)
    return [l.x, l.y]
  }
  const out: Pt[] = [at(lo)]
  line.pts.forEach((q, i) => {
    const c = num(line.cum, i)
    if (c > lo && c < hi) out.push(q)
  })
  out.push(at(hi))
  return s1 >= s0 ? out : out.reverse()
}

function intersect(a: Line, b: Line) {
  for (let i = 0; i < a.pts.length - 1; i++) {
    const p = pt(a.pts, i)
    const p2 = pt(a.pts, i + 1)
    for (let j = 0; j < b.pts.length - 1; j++) {
      const q = pt(b.pts, j)
      const q2 = pt(b.pts, j + 1)
      const rx = p2[0] - p[0]
      const ry = p2[1] - p[1]
      const sx = q2[0] - q[0]
      const sy = q2[1] - q[1]
      const den = rx * sy - ry * sx
      if (Math.abs(den) < 1e-9) continue
      const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den
      const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
          sa: num(a.cum, i) + t * (num(a.cum, i + 1) - num(a.cum, i)),
          sb: num(b.cum, j) + u * (num(b.cum, j + 1) - num(b.cum, j)),
        }
      }
    }
  }
  return { sa: 0, sb: 0 }
}

function offsetPts(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pt(pts, Math.max(i - 1, 0))
    const b = pt(pts, Math.min(i + 1, pts.length - 1))
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d] as Pt
  })
}

function joinLegs(legs: Pt[][], r = 18): Pt[] {
  const out: Pt[] = []
  legs.forEach((leg, k) => {
    const line = makeLine(leg)
    const part = slice(line, k > 0 ? r : 0, k < legs.length - 1 ? line.len - r : line.len)
    if (k > 0) {
      const from = pt(out, out.length - 1)
      const corner = pt(leg, 0)
      const to = pt(part, 0)
      for (let i = 1; i < 10; i++) {
        const t = i / 10
        const m = 1 - t
        out.push([
          m * m * from[0] + 2 * m * t * corner[0] + t * t * to[0],
          m * m * from[1] + 2 * m * t * corner[1] + t * t * to[1],
        ])
      }
    }
    out.push(...part)
  })
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - pt(out, i - 1)[0], p[1] - pt(out, i - 1)[1]) > 0.5)
}

const toD = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')

const roadDefs: { id: string; width: number; ctrl: Pt[] }[] = [
  { id: 'h0', width: 18, ctrl: [[-30, 80], [100, 62], [200, 100], [300, 92], [420, 68], [530, 90]] },
  { id: 'h1', width: 18, ctrl: [[-30, 250], [90, 226], [180, 262], [270, 240], [400, 212], [530, 232]] },
  { id: 'h2', width: 18, ctrl: [[-30, 432], [110, 458], [220, 410], [330, 430], [440, 462], [530, 450]] },
  { id: 'v0', width: 18, ctrl: [[82, -30], [70, 90], [100, 200], [82, 300], [70, 420], [92, 550]] },
  { id: 'v1', width: 18, ctrl: [[232, -30], [248, 90], [210, 180], [240, 280], [265, 420], [242, 550]] },
  { id: 'v2', width: 18, ctrl: [[402, -30], [388, 110], [425, 220], [395, 330], [388, 450], [422, 550]] },
]

const roads = roadDefs.map((r) => {
  const line = markRaw(makeLine(spline(r.ctrl)))
  return { id: r.id, width: r.width, line, d: toD(line.pts) }
})

const roadLine = (id: string) => (roads.find((r) => r.id === id) as (typeof roads)[number]).line

const routeSpecs = [
  { roads: ['h2', 'v1', 'h1', 'v0'], start: 0.88, end: 0.28 },
  { roads: ['v0', 'h2', 'v2'], start: 0.9, end: 0.62 },
  { roads: ['h1', 'v1', 'h0'], start: 0.12, end: 0.28 },
]

const routes = routeSpecs.map((spec) => {
  const legs = spec.roads.map((id, k) => {
    const line = roadLine(id)
    const from = k === 0 ? spec.start * line.len : intersect(roadLine(spec.roads[k - 1] as string), line).sb
    const to =
      k === spec.roads.length - 1 ? spec.end * line.len : intersect(line, roadLine(spec.roads[k + 1] as string)).sa
    return slice(line, from, to)
  })
  const line = markRaw(makeLine(offsetPts(joinLegs(legs), LANE)))
  return { line, d: toD(line.pts), start: pt(line.pts, 0), end: pt(line.pts, line.pts.length - 1) }
})

function laneOf(id: string, dir: 1 | -1) {
  const pts = roadLine(id).pts.slice()
  return makeLine(offsetPts(dir === 1 ? pts : pts.reverse(), LANE))
}

const makeCar = (line: Line, o: Partial<Car>): Car => ({
  line: markRaw(line),
  s: 0,
  v: 0,
  vmax: 40,
  prio: 1,
  scale: 0.8,
  color: '#5aae80',
  loop: true,
  active: true,
  opacity: 1,
  stopped: 0,
  x: 0,
  y: 0,
  a: 0,
  ...o,
})

const state = reactive({
  cars: [
    makeCar(laneOf('h1', 1), { s: 60, vmax: 40, color: '#5aae80', prio: 3 }),
    makeCar(laneOf('v2', -1), { s: 200, vmax: 36, color: '#3f9a6c', prio: 2 }),
    makeCar(laneOf('h2', -1), { s: 300, vmax: 44, color: '#4fa274', prio: 1 }),
    makeCar((routes[0] as (typeof routes)[number]).line, {
      loop: false,
      prio: 10,
      scale: 1,
      color: '#1f5e40',
      vmax: 55,
      opacity: 0,
      active: false,
    }),
  ] as Car[],
  routeIndex: 0,
  phase: 'waiting' as Phase,
  timer: 0,
})

const taxi = state.cars[state.cars.length - 1] as Car
const currentRoute = computed(() => routes[state.routeIndex] as (typeof routes)[number])

function place(c: Car) {
  const l = locate(c.line, c.s)
  c.x = l.x
  c.y = l.y
  c.a = l.a
}

function shouldYield(c: Car, o: Car, dist: number, dx: number, dy: number) {
  const ar = (c.a * Math.PI) / 180
  const ao = (o.a * Math.PI) / 180
  const ahead = (dx * Math.cos(ar) + dy * Math.sin(ar)) / dist
  if (ahead < 0.5) return false
  const same = Math.cos(ar - ao)
  if (same < -0.3) return false
  if (same > 0.7) return true
  if (c.stopped > 2) return false
  return c.prio < o.prio || dist < 18
}

function updateTaxi(dt: number) {
  state.timer += dt
  const route = currentRoute.value

  if (state.phase === 'waiting') {
    taxi.line = route.line
    taxi.s = 0
    taxi.v = 0
    taxi.opacity = 0
    taxi.active = false
    place(taxi)
    const clear = state.cars.every(
      (c) => c === taxi || !c.active || Math.hypot(c.x - route.start[0], c.y - route.start[1]) > 34,
    )
    if (clear) {
      state.phase = 'fadeIn'
      state.timer = 0
      taxi.active = true
    }
  } else if (state.phase === 'fadeIn') {
    taxi.opacity = Math.min(1, state.timer / FADE)
    if (state.timer >= FADE) {
      state.phase = 'drive'
      state.timer = 0
    }
  } else if (state.phase === 'drive') {
    if (taxi.s >= taxi.line.len - 0.3) {
      taxi.s = taxi.line.len
      taxi.v = 0
      state.phase = 'arrived'
      state.timer = 0
    }
  } else if (state.phase === 'arrived') {
    if (state.timer >= PAUSE) {
      state.phase = 'fadeOut'
      state.timer = 0
      taxi.active = false
    }
  } else {
    taxi.opacity = Math.max(0, 1 - state.timer / FADE)
    if (state.timer >= FADE) {
      state.routeIndex = (state.routeIndex + 1) % routes.length
      state.phase = 'waiting'
      state.timer = 0
    }
  }
}

function step(dt: number) {
  for (const c of state.cars) {
    if (!c.active) continue
    const moving = c.loop || state.phase === 'drive'
    if (!moving) {
      c.v = 0
      continue
    }
    let target = c.vmax
    if (!c.loop) target = Math.min(target, Math.sqrt(2 * TAXI_BRAKE * Math.max(c.line.len - c.s, 0)) + 1.5)
    for (const o of state.cars) {
      if (o === c || !o.active) continue
      const dx = o.x - c.x
      const dy = o.y - c.y
      const dist = Math.hypot(dx, dy)
      if (dist > LOOK || dist < 0.01) continue
      if (shouldYield(c, o, dist, dx, dy)) {
        target = Math.min(target, c.vmax * Math.min(Math.max((dist - GAP) / (LOOK - GAP), 0), 1))
      }
    }
    c.v = Math.max(0, c.v + Math.max(-DEC * dt, Math.min(ACC * dt, target - c.v)))
    c.s += c.v * dt
    c.stopped = c.v < 1 ? c.stopped + dt : 0
    if (c.loop && c.s > c.line.len) c.s = 0
  }
  state.cars.forEach(place)
}

state.cars.forEach(place)

let raf = 0
let last = 0

function frame(time: number) {
  const dt = last ? Math.min((time - last) / 1000, 0.05) : 0
  last = time
  updateTaxi(dt)
  step(dt)
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
})
</script>

<template>
  <main class="home">
    <header class="header">
      <div class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
      </div>
    </header>

    <section class="hero">
      <div class="hero__text">
        <h1 class="hero__title">
          Потрібно добратись до певного місця
          <span class="accent">призначення?</span>
        </h1>

        <p class="hero__subtitle">
          <strong>UhilTaxi</strong> — надаємо послуги таксі різних класів для різних ситуацій.
          Реєструйся і замовляй своє таксі.
        </p>

        <div class="hero__actions">
          <button class="btn btn--primary">Зареєструватись</button>
          <button class="btn btn--secondary">Увійти</button>
        </div>
      </div>

      <div class="hero__visual">
        <div class="blob"></div>

        <div class="map-card">
          <svg class="map" viewBox="0 0 500 520" preserveAspectRatio="xMidYMid slice">
            <defs>
              <g id="car">
                <rect x="-11" y="-5" width="22" height="10" rx="3.5" fill="currentColor" />
                <rect x="3" y="-3.5" width="5" height="7" rx="1.5" fill="#d7ecdf" />
                <rect x="-8" y="-3.5" width="3" height="7" rx="1" fill="#d7ecdf" opacity="0.6" />
              </g>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>

            <rect width="500" height="520" fill="#eef3ec" />

            <g fill="#e2ebe0">
              <rect x="110" y="120" width="95" height="95" rx="18" transform="rotate(-6 157 167)" />
              <rect x="270" y="350" width="95" height="55" rx="14" transform="rotate(5 317 377)" />
              <rect x="115" y="345" width="90" height="50" rx="14" transform="rotate(-4 160 370)" />
              <rect x="112" y="462" width="95" height="50" rx="14" transform="rotate(3 160 487)" />
              <rect x="440" y="120" width="70" height="90" rx="14" transform="rotate(6 475 165)" />
              <rect x="440" y="280" width="70" height="100" rx="14" transform="rotate(-5 475 330)" />
              <rect x="-15" y="120" width="65" height="100" rx="14" transform="rotate(-4 17 170)" />
              <rect x="-15" y="290" width="65" height="110" rx="14" transform="rotate(5 17 345)" />
              <rect x="110" y="-10" width="90" height="60" rx="14" transform="rotate(4 155 20)" />
              <rect x="270" y="-10" width="100" height="70" rx="14" transform="rotate(-3 320 25)" />
            </g>

            <ellipse cx="320" cy="165" rx="55" ry="40" fill="#d6e8d9" transform="rotate(-8 320 165)" />
            <g fill="#bcd9c3">
              <circle cx="295" cy="155" r="9" />
              <circle cx="330" cy="145" r="11" />
              <circle cx="345" cy="180" r="8" />
              <circle cx="310" cy="185" r="10" />
            </g>

            <ellipse cx="320" cy="488" rx="50" ry="26" fill="#d6e8d9" />
            <g fill="#bcd9c3">
              <circle cx="300" cy="485" r="8" />
              <circle cx="330" cy="480" r="10" />
              <circle cx="350" cy="492" r="6" />
            </g>

            <path
              d="M-20 330 C 70 300, 150 362, 250 336 S 410 292, 520 322"
              fill="none"
              stroke="#cfe4df"
              stroke-width="34"
              stroke-linecap="round"
            />

            <g stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" fill="none">
              <path v-for="road in roads" :key="road.id" :d="road.d" :stroke-width="road.width" />
            </g>

            <g :opacity="taxi.opacity">
              <path
                :d="currentRoute.d"
                fill="none"
                stroke="#2f7d57"
                stroke-width="9"
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity="0.3"
                filter="url(#glow)"
              />
              <path
                :d="currentRoute.d"
                fill="none"
                stroke="#2f7d57"
                stroke-width="4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                :d="currentRoute.d"
                class="route-flow"
                fill="none"
                stroke="#bfe0cb"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-dasharray="5 15"
              />

              <circle :cx="currentRoute.start[0]" :cy="currentRoute.start[1]" r="9" fill="#2f7d57" />
              <circle :cx="currentRoute.start[0]" :cy="currentRoute.start[1]" r="4" fill="#ffffff" />

              <g :transform="`translate(${currentRoute.end[0]} ${currentRoute.end[1]})`">
                <circle r="8" fill="#2b2b26" opacity="0.15">
                  <animate attributeName="r" values="6;18;6" dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.25;0;0.25" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <path
                  d="M0 -32 C -15 -32 -17 -17 -17 -15 C -17 -3 0 9 0 9 C 0 9 17 -3 17 -15 C 17 -17 15 -32 0 -32 Z"
                  fill="#2b2b26"
                />
                <circle cx="0" cy="-16" r="6" fill="#fbf7ee" />
              </g>
            </g>

            <g
              v-for="(car, i) in state.cars"
              :key="i"
              :transform="`translate(${car.x.toFixed(2)} ${car.y.toFixed(2)}) rotate(${car.a.toFixed(1)})`"
              :opacity="car.opacity"
            >
              <circle v-if="!car.loop" r="14" fill="#2f7d57" opacity="0.2">
                <animate attributeName="r" values="12;18;12" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <use href="#car" :transform="`scale(${car.scale})`" :style="{ color: car.color }" />
            </g>
          </svg>
        </div>

        <div class="cards">
          <div class="float-card">
            <span class="float-card__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <div>
              <span class="float-card__title">Пошук водія за 15 секунд</span>
              <span class="float-card__text">Підбираємо найближче авто</span>
            </div>
          </div>

          <div class="float-card">
            <span class="float-card__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v18M5 7h14" />
                <path d="M5 7 2 14a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7Z" />
              </svg>
            </span>
            <div>
              <span class="float-card__title">Баланс ціни і комфорту</span>
              <span class="float-card__text">Клас під будь-яку ситуацію</span>
            </div>
          </div>

          <div class="float-card">
            <span class="float-card__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
              </svg>
            </span>
            <div>
              <span class="float-card__title">Швидке прибуття</span>
              <span class="float-card__text">Навіть у час пік</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  padding: 0 clamp(20px, 6vw, 96px);
  overflow-x: hidden;
}

.header {
  padding: 28px 0;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.logo__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #2f7d57;
  color: #fbf7ee;
  font-size: 22px;
  font-weight: 700;
}

.logo__name {
  font-size: 24px;
  font-weight: 700;
  color: #2b2b26;
}

.logo__name span {
  color: #2f7d57;
}

.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(40px, 5vw, 80px);
  align-items: center;
  min-height: calc(100vh - 100px);
  padding-bottom: 60px;
}

.hero__title {
  margin: 0 0 24px;
  font-size: clamp(36px, 4.4vw, 60px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #2b2b26;
}

.accent {
  color: #2f7d57;
}

.hero__subtitle {
  margin: 0 0 40px;
  max-width: 560px;
  font-size: clamp(16px, 1.4vw, 19px);
  line-height: 1.7;
  color: #6b675c;
}

.hero__subtitle strong {
  color: #2b2b26;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.btn {
  padding: 16px 32px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn--primary {
  border: 2px solid #2f7d57;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 8px 24px rgba(47, 125, 87, 0.25);
}

.btn--primary:hover {
  background: #266a49;
  border-color: #266a49;
  transform: translateY(-2px);
}

.btn--secondary {
  border: 2px solid #2f7d57;
  background: transparent;
  color: #2f7d57;
}

.btn--secondary:hover {
  background: rgba(47, 125, 87, 0.08);
  transform: translateY(-2px);
}

.hero__visual {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.blob {
  position: absolute;
  inset: 5%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(47, 125, 87, 0.2), transparent 70%);
  filter: blur(40px);
}

.map-card {
  position: relative;
  width: 100%;
  max-width: 560px;
  aspect-ratio: 500 / 520;
  padding: 12px;
  border: 1px solid #ece5d6;
  border-radius: 32px;
  background: #fffdf8;
  box-shadow: 0 30px 70px rgba(60, 50, 30, 0.12);
}

.map {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 22px;
}

.route-flow {
  animation: flow 1.2s linear infinite;
}

.cards {
  position: absolute;
  top: 8%;
  right: -6%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}

.float-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px 14px 14px;
  border: 1px solid #ece5d6;
  border-radius: 20px;
  background: rgba(255, 253, 248, 0.94);
  backdrop-filter: blur(12px);
  box-shadow: 0 18px 40px rgba(60, 50, 30, 0.14);
  opacity: 0;
  animation:
    appear 0.7s ease forwards,
    float 6s ease-in-out infinite;
}

.float-card:nth-child(1) {
  animation-delay: 0.3s, 1s;
}

.float-card:nth-child(2) {
  margin-right: 28px;
  animation-delay: 0.55s, 2s;
}

.float-card:nth-child(3) {
  animation-delay: 0.8s, 3s;
}

.float-card__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, #3f9a6c, #2f7d57);
  color: #fbf7ee;
  box-shadow: 0 6px 14px rgba(47, 125, 87, 0.3);
}

.float-card__icon svg {
  width: 20px;
  height: 20px;
}

.float-card__title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: #2b2b26;
  white-space: nowrap;
}

.float-card__text {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: #8a8578;
  white-space: nowrap;
}

@keyframes flow {
  to {
    stroke-dashoffset: -20;
  }
}

@keyframes appear {
  from {
    opacity: 0;
    transform: translateX(20px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes float {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -8px;
  }
}

@media (max-width: 960px) {
  .hero {
    grid-template-columns: 1fr;
    min-height: auto;
    padding-top: 40px;
  }

  .cards {
    right: 0;
  }
}

@media (max-width: 520px) {
  .float-card {
    padding: 10px 14px 10px 10px;
  }

  .float-card:nth-child(2) {
    margin-right: 0;
  }

  .float-card__icon {
    width: 34px;
    height: 34px;
  }

  .float-card__title {
    font-size: 13px;
  }

  .float-card__text {
    font-size: 11px;
  }
}
</style>