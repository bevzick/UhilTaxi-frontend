<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue'

type Pt = [number, number]
type Phase = 'waiting' | 'fadeIn' | 'drive' | 'arrived' | 'fadeOut'

interface Line {
  pts: Pt[]
  cum: number[]
  len: number
}

interface Route {
  line: Line
  d: string
  start: Pt
  end: Pt
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
const RAD = Math.PI / 180

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
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
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
    a: Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD,
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

const roadLines = new Map(roadDefs.map((r) => [r.id, makeLine(spline(r.ctrl))]))
const roadLine = (id: string) => roadLines.get(id) as Line
const roads = roadDefs.map((r) => ({ id: r.id, width: r.width, d: toD(roadLine(r.id).pts) }))

const routeSpecs = [
  { roads: ['h2', 'v1', 'h1', 'v0'], start: 0.88, end: 0.28 },
  { roads: ['v0', 'h2', 'v2'], start: 0.9, end: 0.62 },
  { roads: ['h1', 'v1', 'h0'], start: 0.12, end: 0.28 },
]

const routes: Route[] = routeSpecs.map((spec) => {
  const legs = spec.roads.map((id, k) => {
    const line = roadLine(id)
    const from = k === 0 ? spec.start * line.len : intersect(roadLine(spec.roads[k - 1] as string), line).sb
    const to =
      k === spec.roads.length - 1 ? spec.end * line.len : intersect(line, roadLine(spec.roads[k + 1] as string)).sa
    return slice(line, from, to)
  })
  const line = makeLine(offsetPts(joinLegs(legs), LANE))
  return { line, d: toD(line.pts), start: pt(line.pts, 0), end: pt(line.pts, line.pts.length - 1) }
})

function laneOf(id: string, dir: 1 | -1) {
  const pts = roadLine(id).pts.slice()
  return makeLine(offsetPts(dir === 1 ? pts : pts.reverse(), LANE))
}

const makeCar = (line: Line, o: Partial<Car>): Car => ({
  line,
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

const cars: Car[] = [
  makeCar(laneOf('h1', 1), { s: 60, vmax: 40, color: '#5aae80', prio: 3 }),
  makeCar(laneOf('v2', -1), { s: 200, vmax: 36, color: '#3f9a6c', prio: 2 }),
  makeCar(laneOf('h2', -1), { s: 300, vmax: 44, color: '#4fa274', prio: 1 }),
  makeCar((routes[0] as Route).line, {
    loop: false,
    prio: 10,
    scale: 1,
    color: '#1f5e40',
    vmax: 55,
    opacity: 0,
    active: false,
  }),
]

const taxi = cars[cars.length - 1] as Car
const routeIndex = ref(0)
const currentRoute = computed(() => routes[routeIndex.value] as Route)
let phase: Phase = 'waiting'
let timer = 0

const carEls: (SVGGElement | null)[] = []
const setCarEl = (i: number) => (el: unknown) => {
  carEls[i] = el as SVGGElement | null
}
const routeEl = ref<SVGGElement | null>(null)
const mapEl = ref<HTMLElement | null>(null)

const carTransform = (c: Car) => `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) rotate(${c.a.toFixed(1)})`

function place(c: Car) {
  const l = locate(c.line, c.s)
  c.x = l.x
  c.y = l.y
  c.a = l.a
}

function render() {
  cars.forEach((c, i) => {
    const el = carEls[i]
    if (!el) return
    el.setAttribute('transform', carTransform(c))
    if (!c.loop) el.setAttribute('opacity', c.opacity.toFixed(3))
  })
  routeEl.value?.setAttribute('opacity', taxi.opacity.toFixed(3))
}

function shouldYield(c: Car, o: Car, dist: number, dx: number, dy: number) {
  const ar = c.a * RAD
  const ahead = (dx * Math.cos(ar) + dy * Math.sin(ar)) / dist
  if (ahead < 0.5) return false
  const same = Math.cos(ar - o.a * RAD)
  if (same < -0.3) return false
  if (same > 0.7) return true
  if (c.stopped > 2) return false
  return c.prio < o.prio || dist < 18
}

function updateTaxi(dt: number) {
  timer += dt
  const route = currentRoute.value

  if (phase === 'waiting') {
    taxi.line = route.line
    taxi.s = 0
    taxi.v = 0
    taxi.opacity = 0
    taxi.active = false
    place(taxi)
    const clear = cars.every(
      (c) => c === taxi || !c.active || Math.hypot(c.x - route.start[0], c.y - route.start[1]) > 34,
    )
    if (clear) {
      phase = 'fadeIn'
      timer = 0
      taxi.active = true
    }
  } else if (phase === 'fadeIn') {
    taxi.opacity = Math.min(1, timer / FADE)
    if (timer >= FADE) {
      phase = 'drive'
      timer = 0
    }
  } else if (phase === 'drive') {
    if (taxi.s >= taxi.line.len - 0.3) {
      taxi.s = taxi.line.len
      taxi.v = 0
      phase = 'arrived'
      timer = 0
    }
  } else if (phase === 'arrived') {
    if (timer >= PAUSE) {
      phase = 'fadeOut'
      timer = 0
      taxi.active = false
    }
  } else {
    taxi.opacity = Math.max(0, 1 - timer / FADE)
    if (timer >= FADE) {
      routeIndex.value = (routeIndex.value + 1) % routes.length
      phase = 'waiting'
      timer = 0
    }
  }
}

function step(dt: number) {
  for (const c of cars) {
    if (!c.active) continue
    if (!c.loop && phase !== 'drive') {
      c.v = 0
      continue
    }
    let target = c.vmax
    if (!c.loop) target = Math.min(target, Math.sqrt(2 * TAXI_BRAKE * Math.max(c.line.len - c.s, 0)) + 1.5)
    for (const o of cars) {
      if (o === c || !o.active) continue
      const dx = o.x - c.x
      const dy = o.y - c.y
      if (Math.abs(dx) > LOOK || Math.abs(dy) > LOOK) continue
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
  cars.forEach(place)
}

cars.forEach(place)

let raf = 0
let last = 0
let running = false

function frame(time: number) {
  if (!running) return
  const dt = last ? Math.min((time - last) / 1000, 0.05) : 0
  last = time
  updateTaxi(dt)
  step(dt)
  render()
  raf = requestAnimationFrame(frame)
}

function startLoop() {
  if (running) return
  running = true
  last = 0
  raf = requestAnimationFrame(frame)
}

function stopLoop() {
  running = false
  cancelAnimationFrame(raf)
}

const heroActions = ref<HTMLElement | null>(null)
const ctaEl = ref<HTMLElement | null>(null)
const passedHero = ref(false)
const ctaVisible = ref(false)
const showBar = computed(() => passedHero.value && !ctaVisible.value)
const observers: IntersectionObserver[] = []

function watchEl(el: HTMLElement | null, cb: (entry: IntersectionObserverEntry) => void, options?: IntersectionObserverInit) {
  if (!el) return
  const observer = new IntersectionObserver(([entry]) => entry && cb(entry), options)
  observer.observe(el)
  observers.push(observer)
}

onMounted(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reduced) {
    taxi.s = taxi.line.len
    taxi.opacity = 1
    place(taxi)
    render()
  } else {
    watchEl(mapEl.value, (e) => (e.isIntersecting ? startLoop() : stopLoop()), { rootMargin: '100px' })
  }

  watchEl(heroActions.value, (e) => {
    passedHero.value = !e.isIntersecting && e.boundingClientRect.top < 0
  })
  watchEl(ctaEl.value, (e) => {
    ctaVisible.value = e.isIntersecting
  })
})

let revealObserver: IntersectionObserver | null = null

function getRevealObserver() {
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('reveal--visible')
        revealObserver?.unobserve(entry.target)
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  )
  return revealObserver
}

const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    el.classList.add('reveal')
    el.style.setProperty('--delay', `${binding.value ?? 0}ms`)
    getRevealObserver().observe(el)
  },
  unmounted(el) {
    revealObserver?.unobserve(el)
  },
}

onBeforeUnmount(() => {
  stopLoop()
  observers.forEach((o) => o.disconnect())
  revealObserver?.disconnect()
  revealObserver = null
})

const audiences = ['Вдень і вночі', 'Для роботи і відпочинку', 'Для сімей і компаній']
const carClasses = ['Economy', 'Comfort', 'Business', 'Мінівен', 'Універсал', 'Електро']
const luggage = ['Великі валізи', 'Дитяче крісло', 'Компанія друзів']
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
          Потрібно добратись до певного 
          <span class="accent">місця призначення</span>
          ?
        </h1>

        <p class="hero__subtitle">
          <strong>UhilTaxi</strong> — надаємо послуги таксі різних класів для різних ситуацій.
          Реєструйся і замовляй своє таксі.
        </p>

        <div ref="heroActions" class="hero__actions">
          <RouterLink to="/auth?mode=register" class="btn btn--primary">Зареєструватись</RouterLink>
          <RouterLink to="/auth" class="btn btn--secondary">Увійти</RouterLink>
        </div>
      </div>

      <div class="hero__visual">
        <div class="blob"></div>

        <div ref="mapEl" class="map-card">
          <svg class="map" viewBox="0 0 500 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
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

            <g ref="routeEl" opacity="0">
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
              v-for="(car, i) in cars"
              :key="i"
              :ref="setCarEl(i)"
              :transform="carTransform(car)"
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

    <section class="about">
      <div class="intro">
        <div v-reveal class="intro__head">
          <span class="eyebrow">Про UhilTaxi</span>
          <h2 class="intro__title">
            Таксі для кожного.<br />
            <span class="accent">Для будь-якої ситуації.</span>
          </h2>
        </div>

        <div v-reveal="150" class="intro__body">
          <p>
            Ми надаємо послуги для різних людей, у різний час і для різних ситуацій. Підлаштовуємось під ваші
            потреби та вподобання, щоб кожна поїздка була саме такою, як вам потрібно.
          </p>
          <div class="pills">
            <span v-for="item in audiences" :key="item" class="pill">{{ item }}</span>
          </div>
        </div>
      </div>

      <div class="bento">
        <article v-reveal class="card card--wide">
          <div class="card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 17h14M6 17v2M18 17v2" />
              <path d="M4 17v-4l2-5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 8l2 5v4" />
              <path d="M4 13h16" />
              <circle cx="7.5" cy="15" r="0.6" fill="currentColor" />
              <circle cx="16.5" cy="15" r="0.6" fill="currentColor" />
            </svg>
          </div>
          <h3 class="card__title">Обирайте клас, марку і тип автомобіля</h3>
          <p class="card__text">
            Від економного авто для щоденних поїздок до бізнес-класу для важливих зустрічей — ви самі вирішуєте, на
            чому їхати.
          </p>
          <div class="chips">
            <span v-for="item in carClasses" :key="item" class="chip">{{ item }}</span>
          </div>
        </article>

        <article v-reveal="100" class="card">
          <div class="card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </div>
          <h3 class="card__title">Не сподобався водій?</h3>
          <p class="card__text">Просто змініть його. Ваш комфорт для нас важливіший за все.</p>
          <div class="swap">
            <span class="avatar avatar--old">ОК</span>
            <span class="swap__arrow">→</span>
            <span class="avatar avatar--new">МВ</span>
          </div>
        </article>

        <article v-reveal="0" class="card">
          <div class="card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.7c3 3.4 6 7 6 10.3a6 6 0 0 1-12 0c0-3.3 3-6.9 6-10.3Z" />
            </svg>
          </div>
          <h3 class="card__title">Вода та серветки</h3>
          <p class="card__text">У кожному авто безкоштовно. Дрібниця, яка робить поїздку приємнішою.</p>
          <span class="badge">Безкоштовно</span>
        </article>

        <article v-reveal="100" class="card">
          <div class="card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="7" width="14" height="13" rx="2" />
              <path d="M9 7V4h6v3M9 11v5M15 11v5" />
            </svg>
          </div>
          <h3 class="card__title">Будь-який багаж і кількість людей</h3>
          <p class="card__text">Скільки б вас не було і що б ви не везли — знайдемо машину під ваше завдання.</p>
          <div class="chips chips--small">
            <span v-for="item in luggage" :key="item" class="chip">{{ item }}</span>
          </div>
        </article>

        <article v-reveal="200" class="card card--accent">
          <div class="card__icon card__icon--light">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5.5" cy="10" r="2" />
              <circle cx="9.5" cy="5.5" r="2" />
              <circle cx="14.5" cy="5.5" r="2" />
              <circle cx="18.5" cy="10" r="2" />
              <path d="M12 11c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.2 2.4c1-.3 1.8-.6 2.8-.6s1.8.3 2.8.6A2.5 2.5 0 0 0 18 18c0-2.5-3-7-6-7Z" />
            </svg>
          </div>
          <h3 class="card__title">Навіть домашні улюбленці!</h3>
          <p class="card__text">Беріть із собою чотирилапого друга — це не проблема.</p>
          <span class="note">* за деяких умов</span>
        </article>
      </div>

      <div ref="ctaEl" v-reveal class="cta">
        <div class="cta__glow"></div>
        <div class="cta__content">
          <h2 class="cta__title">Машина для будь-якої ситуації — тільки в нас</h2>
          <p class="cta__text">Користуйтеся UhilTaxi та підбирайте авто саме під свої потреби.</p>
        </div>
        <div class="cta__actions">
          <RouterLink to="/auth?mode=register" class="btn btn--primary">Зареєструватись</RouterLink>
          <RouterLink to="/auth" class="btn btn--secondary">Увійти</RouterLink>
        </div>
      </div>
    </section>

    <Transition name="bar">
      <div v-if="showBar" class="mobile-bar">
        <div class="mobile-bar__info">
          <span class="mobile-bar__dot"></span>
          <div class="mobile-bar__copy">
            <span class="mobile-bar__title">Таксі поруч</span>
            <span class="mobile-bar__text">Подача за кілька хвилин</span>
          </div>
        </div>
        <button class="mobile-bar__btn">Зареєструватись</button>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.home {
  --gutter: clamp(16px, 6vw, 96px);
  min-height: 100vh;
  padding: 0 var(--gutter);
  overflow-x: hidden;
  overflow-x: clip;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(40px, 5vw, 80px);
  align-items: center;
  min-height: calc(100vh - 100px);
  padding-bottom: 60px;
}

.hero__text,
.hero__visual {
  min-width: 0;
}

.hero__title {
  margin: 0 0 24px;
  font-size: clamp(36px, 4.4vw, 60px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #2b2b26;
  text-wrap: balance;
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
  text-wrap: pretty;
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
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
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
  inset: -5%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(47, 125, 87, 0.18), rgba(47, 125, 87, 0.06) 60%, transparent);
  pointer-events: none;
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
  contain: layout paint;
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

.about {
  padding: 80px 0 100px;
}

.intro {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
  margin-bottom: 56px;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 18px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #e3efe7;
  color: #2f7d57;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.intro__title {
  margin: 0;
  font-size: clamp(32px, 3.8vw, 52px);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: #2b2b26;
  text-wrap: balance;
}

.intro__body p {
  margin: 0 0 24px;
  font-size: 18px;
  line-height: 1.7;
  color: #6b675c;
  text-wrap: pretty;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pill {
  padding: 8px 16px;
  border: 1px solid #e3dccb;
  border-radius: 999px;
  background: #fffdf8;
  color: #4a473f;
  font-size: 14px;
  font-weight: 500;
}

.bento {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 28px;
  border: 1px solid #ece5d6;
  border-radius: 28px;
  background: #fffdf8;
  box-shadow: 0 10px 30px rgba(60, 50, 30, 0.05);
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease,
    border-color 0.3s ease;
}

.card:hover {
  transform: translateY(-6px);
  border-color: #cfe3d6;
  box-shadow: 0 24px 50px rgba(60, 50, 30, 0.1);
}

.card--wide {
  grid-column: span 2;
}

.card--accent {
  border-color: transparent;
  background: linear-gradient(150deg, #3f9a6c, #2f7d57 60%, #266a49);
  color: #fbf7ee;
}

.card--accent:hover {
  border-color: transparent;
}

.card__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-bottom: 8px;
  border-radius: 16px;
  background: #e3efe7;
  color: #2f7d57;
}

.card__icon svg {
  width: 26px;
  height: 26px;
}

.card__icon--light {
  background: rgba(251, 247, 238, 0.18);
  color: #fbf7ee;
}

.card__title {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
  color: #2b2b26;
  text-wrap: balance;
}

.card--accent .card__title {
  color: #fbf7ee;
}

.card__text {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: #6b675c;
  text-wrap: pretty;
}

.card--accent .card__text {
  color: rgba(251, 247, 238, 0.85);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}

.chip {
  padding: 8px 14px;
  border-radius: 12px;
  background: #f4efe3;
  color: #2b2b26;
  font-size: 14px;
  font-weight: 500;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.chip:hover {
  background: #2f7d57;
  color: #fbf7ee;
}

.chips--small .chip {
  padding: 6px 12px;
  font-size: 13px;
}

.swap {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 12px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 700;
}

.avatar--old {
  background: #f4efe3;
  color: #a39e90;
  text-decoration: line-through;
}

.avatar--new {
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 0 0 4px #e3efe7;
}

.swap__arrow {
  color: #2f7d57;
  font-size: 20px;
  font-weight: 700;
  animation: nudge 1.6s ease-in-out infinite;
}

.badge {
  align-self: flex-start;
  margin-top: auto;
  padding: 8px 14px;
  border-radius: 12px;
  background: #e3efe7;
  color: #2f7d57;
  font-size: 14px;
  font-weight: 600;
}

.note {
  margin-top: auto;
  font-size: 13px;
  color: rgba(251, 247, 238, 0.7);
}

.cta {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 28px;
  margin-top: 20px;
  padding: clamp(32px, 4vw, 52px);
  border-radius: 32px;
  background: #1f3d2e;
  overflow: hidden;
}

.cta__glow {
  position: absolute;
  top: -50%;
  right: -10%;
  width: 480px;
  height: 480px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(90, 174, 128, 0.45), transparent);
  pointer-events: none;
}

.cta__content {
  position: relative;
  max-width: 620px;
}

.cta__title {
  margin: 0 0 10px;
  font-size: clamp(26px, 2.8vw, 38px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: #fbf7ee;
  text-wrap: balance;
}

.cta__text {
  margin: 0;
  font-size: 17px;
  color: rgba(251, 247, 238, 0.75);
}

.cta__actions {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.cta__btn {
  padding: 16px 30px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

.cta__btn--primary {
  border: 2px solid #fbf7ee;
  background: #fbf7ee;
  color: #1f3d2e;
}

.cta__btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}

.cta__btn--ghost {
  border: 2px solid rgba(251, 247, 238, 0.35);
  background: transparent;
  color: #fbf7ee;
}

.cta__btn--ghost:hover {
  border-color: #fbf7ee;
  transform: translateY(-2px);
}

.reveal {
  opacity: 0;
  transform: translateY(40px);
  transition:
    opacity 0.8s ease,
    transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: var(--delay);
}

.reveal--visible {
  opacity: 1;
  transform: translateY(0);
}

.card.reveal--visible:hover {
  transform: translateY(-6px);
  transition-delay: 0s;
}

.mobile-bar {
  display: none;
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

@keyframes nudge {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(4px);
  }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0.6);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(47, 125, 87, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(47, 125, 87, 0);
  }
}

@media (max-width: 960px) {
  .hero {
    grid-template-columns: minmax(0, 1fr);
    min-height: auto;
    padding-top: 40px;
  }

  .hero__visual {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
  }

  .cards {
    right: -2%;
  }

  .intro {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .bento {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .header {
    padding: 18px 0;
  }

  .logo {
    gap: 10px;
  }

  .logo__icon {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    font-size: 19px;
  }

  .logo__name {
    font-size: 20px;
  }

  .hero {
    gap: 28px;
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .hero__title {
    margin-bottom: 14px;
    font-size: clamp(28px, 8.4vw, 38px);
    line-height: 1.12;
  }

  .hero__subtitle {
    margin-bottom: 24px;
    font-size: 15px;
    line-height: 1.65;
  }

  .hero__actions {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 10px;
  }

  .btn {
    width: 100%;
    padding: 14px 10px;
    font-size: 15px;
  }

  .hero__visual {
    flex-direction: column;
    align-items: center;
    padding: 0;
  }

  .blob {
    inset: -10% -20% 10%;
  }

  .map-card {
    width: 100%;
    max-width: 420px;
    aspect-ratio: 1 / 1;
    padding: 8px;
    border-radius: 24px;
    box-shadow: 0 20px 50px rgba(60, 50, 30, 0.12);
  }

  .map {
    border-radius: 17px;
  }

    .cards {
    position: relative;
    top: auto;
    right: auto;
    align-self: stretch;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-top: 14px;
  }

  .float-card {
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    background: #fffdf8;
    backdrop-filter: none;
    box-shadow: 0 8px 20px rgba(60, 50, 30, 0.08);
    animation: appear 0.6s ease forwards;
  }

  .float-card:nth-child(2) {
    margin-right: 0;
  }

  .float-card__icon {
    width: 36px;
    height: 36px;
    border-radius: 11px;
  }

  .float-card__icon svg {
    width: 18px;
    height: 18px;
  }

  .float-card__title {
    font-size: 14px;
    white-space: normal;
  }

  .float-card__text {
    font-size: 12px;
    white-space: normal;
  }

  .about {
    padding: 36px 0 120px;
  }

  .intro {
    gap: 16px;
    margin-bottom: 26px;
  }

  .eyebrow {
    margin-bottom: 12px;
    font-size: 12px;
  }

  .intro__title {
    font-size: clamp(26px, 7.6vw, 34px);
  }

  .intro__body p {
    margin-bottom: 16px;
    font-size: 15px;
    line-height: 1.65;
  }

  .pills {
    gap: 8px;
  }

  .pill {
    padding: 7px 12px;
    font-size: 13px;
  }

  .bento {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .card {
    gap: 10px;
    padding: 20px;
    border-radius: 22px;
  }

  .card--wide {
    grid-column: auto;
  }

  .card__icon {
    width: 44px;
    height: 44px;
    margin-bottom: 4px;
    border-radius: 13px;
  }

  .card__icon svg {
    width: 22px;
    height: 22px;
  }

  .card__title {
    font-size: 18px;
  }

  .card__text {
    font-size: 14.5px;
  }

  .chip {
    padding: 7px 11px;
    font-size: 13px;
  }

  .cta {
    flex-direction: column;
    align-items: stretch;
    gap: 20px;
    margin-top: 12px;
    padding: 28px 20px;
    border-radius: 24px;
  }

  .cta__glow {
    top: -30%;
    right: -45%;
    width: 340px;
    height: 340px;
  }

  .cta__title {
    font-size: clamp(22px, 6.6vw, 28px);
  }

  .cta__text {
    font-size: 15px;
  }

  .cta__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .cta__btn {
    width: 100%;
    padding: 15px 20px;
  }

  .mobile-bar {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 50;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 10px 10px 16px;
    border: 1px solid #ece5d6;
    border-radius: 20px;
    background: rgba(255, 253, 248, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 16px 40px rgba(60, 50, 30, 0.18);
  }

  .mobile-bar__info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .mobile-bar__copy {
    min-width: 0;
  }

  .mobile-bar__dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2f7d57;
    animation: pulse 2s infinite;
  }

  .mobile-bar__title {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #2b2b26;
  }

  .mobile-bar__text {
    display: block;
    overflow: hidden;
    font-size: 12px;
    color: #8a8578;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .mobile-bar__btn {
    flex-shrink: 0;
    padding: 13px 16px;
    border: none;
    border-radius: 14px;
    background: #2f7d57;
    color: #fbf7ee;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 6px 16px rgba(47, 125, 87, 0.3);
    -webkit-tap-highlight-color: transparent;
    display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  }

  .bar-enter-active,
  .bar-leave-active {
    transition:
      transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 0.3s ease;
  }

  .bar-enter-from,
  .bar-leave-to {
    opacity: 0;
    transform: translateY(120%);
  }
}

@media (max-width: 370px) {
  .hero__actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero__visual {
    display: none;
  }

  .mobile-bar__text {
    display: none;
  }
}

@media (hover: none) {
  .card:hover,
  .card.reveal--visible:hover {
    transform: none;
    border-color: #ece5d6;
    box-shadow: 0 10px 30px rgba(60, 50, 30, 0.05);
  }

  .card--accent:hover {
    border-color: transparent;
  }

  .chip:hover {
    background: #f4efe3;
    color: #2b2b26;
  }

  .btn:hover,
  .cta__btn:hover {
    transform: none;
  }

  .btn--primary:hover {
    background: #2f7d57;
  }

  .btn:active,
  .cta__btn:active,
  .mobile-bar__btn:active {
    transform: scale(0.97);
  }
}

@media (prefers-reduced-motion: reduce) {
  .float-card,
  .swap__arrow,
  .route-flow,
  .mobile-bar__dot {
    animation: none;
    opacity: 1;
  }

  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>