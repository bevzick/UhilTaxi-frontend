# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

UhilTaxi — a taxi-ordering SPA for the city of Khmelnytskyi (Ukraine). Vue 3 + TypeScript + Vite, Pinia, Vue Router, Leaflet for the map. All user-facing text (UI copy, validation and error messages) is in Ukrainian — keep new strings in Ukrainian. There is no backend in this repo; the app talks to an external REST API.

## Commands

Node `^22.18.0 || >=24.12.0`.

```sh
npm run dev                 # Vite dev server on :5173
npm run build               # type-check (vue-tsc --build) + vite build, in parallel
npm run type-check          # vue-tsc only
npm run lint                # oxlint --fix, then eslint --fix (both auto-fix)
npm run format              # prettier on src/

npm run test:unit                          # vitest (watch mode), jsdom env
npx vitest run src/__tests__/App.spec.ts   # single unit test file, no watch
npx vitest run -t "test name"              # single test by name

npx playwright install                     # first run only
npm run test:e2e                           # playwright, all browsers; starts dev server itself
npm run test:e2e -- --project=chromium e2e/vue.spec.ts
```

Unit tests live in `src/**/__tests__/` (covered by `tsconfig.vitest.json`); e2e tests live in `e2e/`. The existing `App.spec.ts` and `e2e/vue.spec.ts` are scaffold leftovers that assert template text ("You did it!") which no longer exists.

Style: Prettier with no semicolons, single quotes, 100-char lines. `noUncheckedIndexedAccess` is on.

## Environment

All config comes from `VITE_*` vars in `.env` (`.env.example` is currently empty):

- `VITE_API_URL` — API base URL (must be https in production builds)
- `VITE_AUTH_LOGIN_URL`, `VITE_AUTH_REGISTER_URL`, `VITE_ORDERS_URL` — endpoint *paths* appended to `VITE_API_URL` (must start with `/`)
- `VITE_GEOCODER_URL` — Nominatim-compatible geocoder base (https; http allowed only in dev)
- `VITE_MAP_TILES_URL` — optional Leaflet tile template (defaults to OpenStreetMap; CARTO basemaps now return an "API KEY REQUIRED" watermark without a key)

`index.html` sets a strict Content-Security-Policy via `<meta>`. Any new external origin (tile server, geocoder, API host) must be added to `img-src`/`connect-src` there, or the browser silently blocks it — this is what previously made the map render blank.

## Architecture

**Routing / auth** (`src/router/index.ts`): routes `/` (landing, `HomeView`), `/auth` (`guestOnly`), `/app` (`MapView`, `requiresAuth`). A global `beforeEach` guard reads `useAuth().isAuthenticated`; unauthenticated users go to `/auth?redirect=…`, and redirects back are sanitized through `safeRedirect` in `utils/validation.ts`.

**Auth state is not in Pinia.** `composables/useAuth.ts` holds a module-level `session` ref (shared singleton) persisted to `localStorage` under `uhiltaxi.session`, validated on read, with expiry derived from `expires_in`, and synced across tabs via the `storage` event. `stores/counter.ts` is unused scaffold.

**API layer** (`src/api/`):
- `http.ts` — the single `request<T>()` wrapper around `fetch`. Enforces safe relative paths, 15s timeout, response size cap, `credentials: 'omit'`, `redirect: 'error'`, Bearer token via `options.token`, and converts failures into `ApiError` with a Ukrainian user-facing message (status-specific or a sanitized server message). New endpoints should go through it.
- `auth.ts`, `orders.ts` — thin endpoint wrappers. `orders.ts` also has `prepareOrder(draft)`, which validates an `OrderDraft` (both places inside the city, ≥50 m apart, seats per car type) and maps it to the snake_case `OrderRequest`; it returns `{ data } | { error }` rather than throwing.
- `geocode.ts` — calls the geocoder directly (not via `http.ts`): requests are serialized through a queue with ≥1.1s between calls (Nominatim usage policy), cached (LRU-ish, 60 entries), abortable (`isAbort()` to detect), and bounded to the city viewbox. Results outside the city are dropped.

**City bounds** (`CITY`, `inCity`) gate everything geographic: geocoding results, order validation, and the Leaflet `maxBounds`.

**Defensive input handling is a deliberate project convention** (see recent commits on form protection): all free text passes through `clean()` (NFC/NFKC normalize + strip invisible/bidi chars) and length caps; server messages go through `safeMessage()`; external JSON is treated as `unknown` and narrowed with `isRecord`/`isObject` guards. Follow the same pattern for new inputs and API responses.

**Views**: `MapView.vue` owns the Leaflet map imperatively (markers, route curve from `utils/geo.curvePoints`, geolocation via `useGeolocation`) and has a left "dock" (route panel with two `AddressInput`s, pick-on-map buttons, popular places, CTA) that hides when `OrderSheet.vue` (car class/type/extras form) opens. Pickup is auto-filled from geolocation when available (`source: 'me'`) but never required to come from it; both points can be typed, picked on the map, or dragged. Views are large single-file components with scoped styles; the color palette (cream `#fbf7ee`, green `#2f7d57`) and Inter font are set globally in `App.vue`. Layouts are tuned separately for mobile (breakpoint ~720px).
