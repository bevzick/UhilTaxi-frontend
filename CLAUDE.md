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

- `VITE_API_URL` — backend origin, e.g. `http://localhost:8080` (a trailing `/api/v1` is stripped, since every request path already includes it; must be https in production builds)
All endpoint paths are hard-coded under `/api/v1` in `src/api/*.ts`.
- `VITE_MOCK_API=true` (dev only) — replaces every API call with the in-browser fake backend in `src/api/mock.ts` (state persisted in `localStorage['uhiltaxi.mock']`). Logging in with `+380990000001` gives the driver role, `+380990000002` the admin role; any other phone is a client. Promo codes `UHIL20` / `HACK50` work. Admin changes (blocked accounts, new drivers/tariffs/promos) affect the rest of the mock
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

**Backend contract**: `swagger-final.json` in the repo root is the source of truth (UhilTaxi.Api v1, Bearer JWT). Responses are treated as `unknown` and narrowed in `src/utils/order.ts` (`toOrder`, `toTariffs`, `toEstimate`, `toPaged`…). Order `status` strings are not enumerated in swagger, so `toStage()` maps them by keyword to `searching | accepted | arrived | started | completed | cancelled`; user `role` is likewise matched by keyword (`normalizeRole` in `useAuth`).

**Roles**: the router guard routes by `meta.role` (merged from parent routes): drivers → `/driver` (`DriverView`), admins → `/admin`, everyone else → `/app` (`MapView`). Leaflet setup, marker icons and the route curve shared by both views live in `src/utils/map.ts` + `src/assets/map.css` (global, unscoped marker styles).

**Client ride flow**: `OrderSheet` (tariffs from `/api/v1/tariffs`, per-tariff prices from `/orders/estimate`, promo code) emits `created`; `composables/useActiveOrder.ts` then polls `GET /orders/{id}`, persists the active order in `localStorage['uhiltaxi.active-order']` so a reload resumes tracking, and drives `RideStatus.vue`. The API has no confirm/reject-driver endpoint: confirming is client-side only, and rejecting cancels the order and re-creates the same request to keep searching. Clients only get `assigned_driver_id`; `toOrder` will pick up a nested `driver` object (name, rating, phone, car, plate) if the backend adds one.

**Driver flow**: `DriverView` polls `/driver/orders/available` (list + fare bubbles on the map; selecting draws the route), accepts, then walks `arrived → start → complete` while polling `/driver/orders/{id}` to notice client cancellations. `start` sends `shift_id: 0` because the API exposes no shift endpoint.

**Admin panel** (`/admin`, `AdminView` layout + child routes in `src/views/admin/`): dashboard, orders (detail drawer with route mini-map, status history, assign driver, drive the trip on the driver's behalf, cancel, create an order for a client), clients, drivers, trips, tariffs, promocodes. All calls go through `src/api/admin.ts` (`/api/v1/admin/*`, parsed by `src/utils/admin.ts`). Shared admin styles are global but namespaced under `.adm` in `src/assets/admin.css` (`a-*` classes); drawers teleport into `#adm-layer` inside the layout so they inherit those variables. Toasts and the confirm/prompt dialog are module singletons in `composables/useAdminUi.ts`.

API gaps the admin UI works around: there is no DELETE for accounts, so "removing" a user is `PATCH …/status { is_blocked }` (reversible); there is no client→driver promotion endpoint, so "Зробити водієм" calls `POST /admin/drivers` pre-filled from the client (the backend may reject a duplicate phone). `discount_type` values are not enumerated in swagger — the UI sends `percent` / `fixed`.
