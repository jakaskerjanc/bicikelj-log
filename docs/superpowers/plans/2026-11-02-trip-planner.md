# Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trip planner. Given a start, an end and a Leave at / Arrive by time, it
picks a BicikeLJ pickup station that is likely to have a bike and a drop-off station
that is likely to have a dock, using the typical profiles. It then draws the walk →
bike → walk route from Mapbox Directions.

**Architecture:**
- **Pure logic** lives in `frontend/src/trip/`. Each module has unit tests and no
  React:
  - types
  - geometry and the Ljubljana boundary
  - Ljubljana-time helpers
  - station selection
  - the Mapbox Directions client
  - the Mapbox Search Box `/forward` client
- **`useTrip`** is a hook that debounces the inputs, runs the selection, fetches the
  three legs and builds a `TripResult`.
- **UI:** three new components (`PlaceField`, `TripSearch`, `TripResultView`), new
  overlay props on `StationMap`, and `App` wiring.
- **Backend:** one small change. `meta.json` gains an upcoming `holidays` list, so the
  planner can use the Sunday profile on public holidays.

**Tech Stack:**
- Frontend: Vite 8, React 19, TypeScript, mapbox-gl 3, Vitest 5 with jsdom and React
  Testing Library.
- Backend: Python 3, pytest, the `holidays` package (already a dependency).

**Spec:** `docs/superpowers/specs/2026-11-02-trip-planner-design.md`. Read it first.
The existing app's design is `docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md`,
and the data contract is `docs/superpowers/specs/2026-09-23-typical-availability-design.md`
(section "Output contract").

**Paths:**
- All paths are relative to the repo root.
- `npm` commands run in `frontend/`. `pytest` runs from the repo root as `pytest backend -v`.
- Before Task 2, run `cd frontend && npm ci`. `node_modules` is currently stale:
  `@visx/scale` is missing, so `App.test.tsx` and `StationDetail.test.tsx` fail to
  import. They should pass after `npm ci`.

## Global Constraints

- **Time zone:** all trip times are Ljubljana time (`Europe/Ljubljana`), whatever the
  device timezone. Slot = `hour*4 + floor(minute/15)`, in the range 0–95.
- **Profile for a moment:**
  - its Ljubljana date's weekday (`mon`…`sun`)
  - but `sun` if the date is in `meta.holidays`
  - the `holiday` profile is never fetched
- **Selection constants** live in `frontend/src/trip/plan.ts`, exported:
  - `MAX_WALK_M = 1000` (straight-line)
  - `DETOUR = 1.3`
  - `WALK_MPS = 4.8 / 3.6`
  - `BIKE_MPS = 15 / 3.6`
  - `UNLOCK_S = 60`
  - `DOCK_S = 60`
  - `THRESHOLD = { safe: 0.9, risky: 0.5 }`
- **Chances:** pickup = `1 − p_empty`, drop-off = `1 − p_full`, at the moment you
  *reach* that station. `null` means not usable. Acceptable means `chance >= THRESHOLD[risk]`.
- **Search must stay free:**
  - Mapbox Search Box `/forward` only, never `/suggest` or `/retrieve`
  - params: `auto_complete=true&country=si&bbox=<Ljubljana bbox>&proximity=<lon>,<lat>&limit=5&language=sl`
  - debounce 400 ms, minimum 3 characters, results cached per query string for the page
    session
  - `proximity` is the fixed `LJUBLJANA_CENTER`, not the live map centre as the spec
    says. Inside a Ljubljana-only bbox they're equivalent, and this avoids wiring map
    state into the search field.
- **Directions:** `https://api.mapbox.com/directions/v5/mapbox/{walking|cycling}/{lon},{lat};{lon},{lat}?geometries=geojson&overview=full&access_token=…`,
  cached per (profile, from, to) with coordinates rounded to 5 decimals.
- **Re-planning:** debounce 300 ms after any input change.
- **Inputs:**
  - dates: today to today + 7 (8 options), in Ljubljana
  - time: `<input type="time" step="300">`
  - default: Leave at, now rounded up to the next 5 minutes; an exact 5-minute
    boundary stays as it is
- **Every point** (search result, station match, map pick, my location) must pass
  `insideLjubljana`. Otherwise it is not set, and the notice is shown.
- **Exact copy** (tests assert these):
  - `Where to?`
  - `From`, `To`
  - `My location`, `Choose on map`, `Point on map`
  - `Search unavailable`
  - `Pick a point inside Ljubljana`
  - `Couldn't get your location`
  - `Leave at`, `Arrive by`, `Safe`, `Risky`
  - `Planning…`
  - `Couldn't get the route.` with a `Retry` button
  - `Walking is faster`
  - `No station within 1 km of the start` / `No station within 1 km of the end`
  - `Leave by {t} to arrive by {t}`
- **Clock format** matches the app's existing style: `5:04 AM` (12-hour, no leading zero).
- **Chance label:**
  - format: `{Bike|Free dock} {word} · {n} in 10`
  - `n = clamp(round(chance*10), 1, 9)`
  - `word`: `likely` if chance ≥ 0.9, `possible` if ≥ 0.5, `unlikely` otherwise
  - colour: `colorFor(1 − chance)` from `data/colors.ts`
  - a not-acceptable station also gets the class `warn`
- **No new runtime dependencies.** Geometry, debounce and time-zone math are
  hand-written.
- **Breakpoint** stays `(min-width: 640px)` (`useIsDesktop`).

## Review Focus

1. **DST:** an Arrive by time on a DST-change date (2026-03-29, 2026-10-25) gives the
   correct departure instant. Tests in Task 4.
2. **Arrive by past midnight:** Arrive by 00:10 means a departure, and pickup, on the
   previous date. Those moments must use the previous date's profile. Test in Task 5.
3. **Fast edits:** the user changes inputs while legs are loading. A stale response must
   never replace the newer result. Test in Task 7.
4. **Unaccented typing:** "presernov" must match the station `PREŠERNOV TRG-…`. Test in
   Task 6.
5. **Default time near midnight:** at 23:58 the default must be 00:00 tomorrow, with
   the date set to tomorrow, not today. Test in Task 4.

---

### Task 1: Backend: publish upcoming holidays in `meta.json`

**Files:**
- Modify: `backend/src/bicikelj_log/daytypes.py`
- Modify: `backend/src/bicikelj_log/typical.py:204-214` (`meta_document`)
- Modify: `docs/superpowers/specs/2026-09-23-typical-availability-design.md`
  (`meta.json` example in "Output contract")
- Modify: `frontend/scripts/fake-data.mjs` (write `holidays` into `meta.json`)
- Test: `backend/tests/test_daytypes.py`, `backend/tests/test_typical.py`

**Interfaces:**
- Produces: `meta.json` field `"holidays": ["2026-10-31", …]`. These are ISO dates of
  Slovenian public holidays in `[today, today + 365 days)`, where today is the
  Ljubljana date of `generated_at`. Sorted ascending.
- Produces: `upcoming_holidays(start: date, days: int = 365) -> list[str]` in `daytypes.py`.

- [ ] **Step 1: Write the failing tests**

```python
# test_daytypes.py
def test_upcoming_holidays_lists_si_holidays_in_window():
    got = upcoming_holidays(date(2026, 9, 23))
    assert got[:3] == ["2026-10-31", "2026-11-01", "2026-12-25"]
    assert "2027-03-29" in got          # Easter Monday 2027
    assert got == sorted(got)
    assert all("2026-09-23" <= d < "2027-09-23" for d in got)

def test_upcoming_holidays_respects_days():
    assert upcoming_holidays(date(2026, 10, 31), days=2) == ["2026-10-31", "2026-11-01"]

# test_typical.py (extend test_meta_document)
    assert meta["holidays"][0] == "2026-10-31"
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pytest backend/tests/test_daytypes.py backend/tests/test_typical.py -v`
Expected: FAIL with `ImportError: cannot import name 'upcoming_holidays'`.

- [ ] **Step 3: Implement**

`upcoming_holidays` uses the module's existing `_SI_HOLIDAYS`. `meta_document` adds
`"holidays": upcoming_holidays(generated_at.astimezone(TZ).date())` after `"profiles"`.
In the contract doc's `meta.json` example, add `"holidays": ["2026-10-31", "2026-11-01"]`.
Below the example, add one sentence: Slovenian public holidays in the next 365 days,
used by the trip planner; added 2026-11, additive. In `fake-data.mjs`, add
`holidays: [<the date 2 days from now, YYYY-MM-DD>]` to the meta object, so the Sunday
fallback can be checked locally.

- [ ] **Step 4: Run all backend tests and confirm they pass**

Run: `pytest backend -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend docs/superpowers/specs/2026-09-23-typical-availability-design.md frontend/scripts/fake-data.mjs
git commit -m "feat(backend): publish upcoming public holidays in meta.json"
```

---

### Task 2: Frontend data: `Meta.holidays` and all loaded profiles

**Files:**
- Modify: `frontend/src/data/types.ts`, `frontend/src/data/api.ts` (`parseMeta`),
  `frontend/src/data/useTypical.ts`
- Modify: `frontend/src/test/fixtures.ts` (`META` gets `holidays: []`)
- Test: `frontend/src/data/api.test.ts`, `frontend/src/data/useTypical.test.ts`

**Interfaces:**
- Produces: `Meta.holidays: string[]`, always present. A missing field gives `[]`.
  Entries not matching `/^\d{4}-\d{2}-\d{2}$/` are dropped, and that is not an error,
  so a planner-only field can't break the map.
- Produces: `TypicalData.profiles: Partial<Record<Day, Profile>>`, every profile loaded
  so far.
- Produces: `TypicalData.allStatus: LoadStatus`:
  - `'ready'` once meta and all 7 profiles are loaded
  - `'error'` if meta or any profile fetch (including a background prefetch) failed
    and hasn't loaded since
  - `'loading'` otherwise
- `retry()` re-requests anything that failed. The existing fields are unchanged.

- [ ] **Step 1: Write the failing tests**

- `parseMeta` without `holidays` → `holidays` equals `[]`.
- With `holidays: ["2026-12-25", 7, "nope"]` → `["2026-12-25"]`.
- `useTypical`: after the initial day and the prefetch settle, `result.current.profiles`
  has all 7 keys `mon`…`sun`, and `allStatus` is `'ready'`.
- With `routes['thu.json'] = FAIL`: `status` is `'ready'` (selected day `mon`) but
  `allStatus` is `'error'`. After fixing the route and calling `retry()`, `allStatus`
  is `'ready'`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/data`
Expected: the new assertions FAIL.

- [ ] **Step 3: Implement**

Add `holidays` to `Meta` and `parseMeta`. Return the existing `profiles` state from
`useTypical`. Track prefetch failures in state for `allStatus`. Today they are
swallowed with `() => {}`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): expose holidays and all loaded profiles"
```

---

### Task 3: Trip types, geometry and the Ljubljana boundary

**Files:**
- Create: `frontend/src/trip/types.ts`, `frontend/src/trip/geo.ts`,
  `frontend/src/trip/boundary.ts`, `frontend/src/trip/ljubljana-boundary.json`
- Test: `frontend/src/trip/geo.test.ts`

**Interfaces:**
- Produces, `types.ts`:

```ts
export interface LngLat { lon: number; lat: number }
export interface Place { name: string; detail: string; at: LngLat }
export type Risk = 'safe' | 'risky';
export type TimeMode = 'leave' | 'arrive';
export interface TripInputs {
  from: Place | null; to: Place | null;
  timeMode: TimeMode; date: string /* YYYY-MM-DD */; time: string /* HH:MM */; risk: Risk;
}
export interface Leg { mode: 'walk' | 'bike'; durationS: number; distanceM: number; geometry: import('geojson').LineString }
export interface StationOdds { station: import('../data/types').Station; chance: number | null; acceptable: boolean }
export type TripResult =
  | { kind: 'bike'; depart: Date; arrive: Date; legs: [Leg, Leg, Leg]; pickup: StationOdds; dropoff: StationOdds;
      limitedData: boolean /* a profile read for pickup or drop-off has days_used < LIMITED_DATA_DAYS */ }
  | { kind: 'walk'; depart: Date; arrive: Date; legs: [Leg] }
  | { kind: 'no-station'; end: 'start' | 'end' };
```

- Produces, `geo.ts`:
  - `distanceM(a: LngLat, b: LngLat): number` (haversine, Earth radius 6 371 000 m)
  - `pointInPolygon(p: LngLat, poly: Polygon | MultiPolygon): boolean` (ray casting;
    holes are respected)
- Produces, `boundary.ts`:
  - `LJUBLJANA_BOUNDARY: Feature<Polygon | MultiPolygon>`
  - `LJUBLJANA_BBOX: [minLon, minLat, maxLon, maxLat]`, computed from the polygon
  - `LJUBLJANA_CENTER: LngLat = { lon: 14.5058, lat: 46.0569 }`
  - `insideLjubljana(p: LngLat): boolean`

- [ ] **Step 1: Fetch the boundary**

This is OSM relation 1675898, *Mestna občina Ljubljana*, simplified by Nominatim:

```bash
curl -s -A "bicikelj-log (jakaskerjanc@gmail.com)" \
  "https://nominatim.openstreetmap.org/lookup?osm_ids=R1675898&polygon_geojson=1&polygon_threshold=0.0005&format=json"
```

Save `[0].geojson` wrapped as a GeoJSON `Feature` (with `properties: { source: "© OpenStreetMap contributors, ODbL" }`)
to `ljubljana-boundary.json`. Expected: a `Polygon` of about 10 KB, with a bbox of
roughly lat 45.974–46.146 and lon 14.409–14.755.

- [ ] **Step 2: Write the failing tests**

- `distanceM` of Prešernov trg (46.0514, 14.506) to Kongresni trg (46.05, 14.503) is
  between 250 and 300.
- Inside: Ljubljana centre, Prešernov trg, and the main train station (46.0583, 14.5103).
- Outside: Kranj (46.2389, 14.3556), Vrhnika (45.9636, 14.2953), and the open sea
  (45.5, 13.6).
- `pointInPolygon` on a square with a square hole: a point in the hole gives `false`.
- `LJUBLJANA_BBOX` contains all three inside points.

- [ ] **Step 3: Run them and confirm they fail**

Run: `npm test -- src/trip/geo`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

Write `geo.ts` and `boundary.ts`. Import the JSON with
`import boundary from './ljubljana-boundary.json'`; Vite and Vitest handle it natively.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- src/trip/geo && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/trip
git commit -m "feat(trip): types, geometry and Ljubljana boundary"
```

---

### Task 4: Ljubljana time helpers

**Files:**
- Create: `frontend/src/trip/time.ts`
- Test: `frontend/src/trip/time.test.ts`

**Interfaces:**
- Produces:
  - `ljubljanaInstant(date: string, time: string): Date`: Ljubljana wall clock → instant.
    In the DST gap, it moves forward by the gap. In the overlap, it takes the first
    (CEST) occurrence.
  - `profileSlot(t: Date, holidays: ReadonlySet<string>): { day: Day; slot: number }`:
    `day` is the weekday of `t`'s Ljubljana date, or `'sun'` if that date is in
    `holidays`.
  - `tripDates(now: Date): string[]`: 8 Ljubljana dates starting today.
  - `defaultTripTime(now: Date): { date: string; time: string }`: rounds up to the next
    5 minutes, carrying over into the next date when needed.
  - `formatClock(t: Date): string`: Ljubljana time as `"5:04 AM"`.
  - `formatDateOption(date: string, today: string): string`: `"Today"`, `"Tomorrow"`,
    otherwise `"Wed 4 Nov"`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(ljubljanaInstant('2026-12-01', '05:30').toISOString()).toBe('2026-12-01T04:30:00.000Z');
expect(ljubljanaInstant('2026-07-01', '05:30').toISOString()).toBe('2026-07-01T03:30:00.000Z');
expect(ljubljanaInstant('2026-03-29', '03:30').toISOString()).toBe('2026-03-29T01:30:00.000Z'); // after spring-forward
expect(ljubljanaInstant('2026-10-25', '05:30').toISOString()).toBe('2026-10-25T04:30:00.000Z'); // after fall-back
const h = new Set(['2026-12-25']);
expect(profileSlot(new Date('2026-12-25T04:30:00Z'), h)).toEqual({ day: 'sun', slot: 22 }); // Fri holiday → Sunday
expect(profileSlot(new Date('2026-12-24T23:05:00Z'), new Set())).toEqual({ day: 'fri', slot: 0 }); // 00:05 local next day
expect(defaultTripTime(new Date('2026-11-02T22:58:00Z'))).toEqual({ date: '2026-11-03', time: '00:00' });
expect(defaultTripTime(new Date('2026-11-02T04:00:00Z'))).toEqual({ date: '2026-11-02', time: '05:00' });
expect(tripDates(new Date('2026-11-02T10:00:00Z'))).toHaveLength(8);
expect(formatClock(new Date('2026-11-03T04:04:00Z'))).toBe('5:04 AM');
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/trip/time`

- [ ] **Step 3: Implement**

Use `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', … }).formatToParts`,
like `data/slots.ts`'s `nowInLjubljana`. `ljubljanaInstant` uses the two-pass offset
method: a UTC guess, then the zone offset at the guess, then a re-check.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/trip/time && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/trip
git commit -m "feat(trip): Ljubljana time and profile-slot helpers"
```

---

### Task 5: Station selection (pure)

**Files:**
- Create: `frontend/src/trip/plan.ts`
- Test: `frontend/src/trip/plan.test.ts`

**Interfaces:**
- Consumes: `distanceM` (Task 3), `profileSlot` (Task 4), `Station`, `Profile`, `Day`.
- Produces the constants from Global Constraints, plus:

```ts
export type Profiles = Partial<Record<Day, Profile>>;
export interface LegSeconds { walk1: number; ride: number; walk2: number }
export interface Timeline { depart: Date; atPickup: Date; atDropoff: Date; arrive: Date }
export interface SelectQuery { from: LngLat; to: LngLat; time: Date; timeMode: TimeMode; risk: Risk }
export type Selection =
  | { kind: 'bike'; pickup: Station; dropoff: Station; estimate: LegSeconds }
  | { kind: 'walk' }
  | { kind: 'no-station'; end: 'start' | 'end' };

export function timeline(time: Date, mode: TimeMode, legs: LegSeconds): Timeline;
export function stationChance(profiles: Profiles, holidays: ReadonlySet<string>, id: string,
  role: 'pickup' | 'dropoff', at: Date): number | null;
export function selectStations(q: SelectQuery, stations: Station[], profiles: Profiles,
  holidays: ReadonlySet<string>): Selection;
```

**Timeline:**
- `atPickup = depart + walk1`
- `atDropoff = atPickup + UNLOCK_S + ride`
- `arrive = atDropoff + DOCK_S + walk2`
- For Arrive by, `depart = time − (walk1 + UNLOCK_S + ride + DOCK_S + walk2)`.

**Estimates:** `walk = distanceM × DETOUR / WALK_MPS`; `ride = distanceM × DETOUR / BIKE_MPS`.

**Algorithm for `selectStations`:**
1. Pickup candidates are stations with `distanceM(from) ≤ MAX_WALK_M`. Drop-off
   candidates are stations with `distanceM(to) ≤ MAX_WALK_M`.
2. If there are no pickup candidates, return `no-station start`. If there are no
   drop-off candidates, return `no-station end`.
3. For every pair with `pickup.id !== dropoff.id`, estimate the legs, build the
   timeline, and compute both chances at `atPickup` and `atDropoff`. Skip a pair when
   either chance is `null`.
4. If no pair survives step 3:
   - if no pair had a non-null pickup chance, return `no-station start`
   - otherwise return `no-station end`
5. The best pair is:
   - among acceptable pairs (both chances ≥ `THRESHOLD[risk]`), the minimum estimated
     total, with ties going to the higher `pickupChance × dropoffChance`
   - if no pair is acceptable, the maximum `pickupChance × dropoffChance`
6. If the walking-only estimate `distanceM(from, to) × DETOUR / WALK_MPS` is ≤ the best
   pair's estimated total (including `UNLOCK_S` and `DOCK_S`), return `walk`. Return
   `walk` too when every candidate pair was skipped for having `pickup === dropoff`.
7. Otherwise return `bike` with the best pair and its estimate.

- [ ] **Step 1: Write the failing tests**

Build tiny station sets in the test file, with stations about 300 m apart along a line,
and a profile builder that sets `p_empty` and `p_full` per station per slot. Cases, one
`it` each:
- **Safe vs Risky:** the nearest pickup has `p_empty = 0.3` and one 600 m away has
  `0.05`. Safe picks the far one; Risky picks the near one.
- **Pickup slot ≠ departure slot:** Leave at 07:59 with an estimated walk of ~4 min.
  The nearest station is empty in slot 31 but fine in slot 32, so it is chosen.
- **Arrive by:** `timeline(…, 'arrive', …)` gives `arrive` equal to the requested time,
  and `depart` earlier by the total.
- **Arrive by just after midnight:** Arrive by 00:10 on Tue 2026-11-03. The pickup
  moment is on Mon 2026-11-02, so the chance comes from the `mon` profile (give `mon`
  and `tue` different values). Place the stations so that
  `UNLOCK_S + ride + DOCK_S + walk2 > 10 min`; otherwise the pickup lands after
  midnight.
- **Holiday:** a trip on Fri 2026-12-25 reads the `sun` profile.
- **Null data:** a station whose slot is `null` is never chosen. If every pickup is
  `null`, the result is `no-station start`.
- **No acceptable pair:** the result is the best pair, and `stationChance` for it is
  below the threshold. `useTrip` turns that into `acceptable: false`.
- **No station within 1 km of `to`:** the result is `no-station end`.
- **Walking is faster:** `from` and `to` are 150 m apart, so the result is `walk`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/trip/plan`

- [ ] **Step 3: Implement `plan.ts`**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/trip/plan && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/trip
git commit -m "feat(trip): pick pickup and drop-off stations from typical profiles"
```

---

### Task 6: Mapbox clients: Directions, place search and station matching

**Files:**
- Create: `frontend/src/trip/directions.ts`, `frontend/src/trip/search.ts`
- Modify: `frontend/src/test/fixtures.ts`. Extend `mockFetch` so that, for
  `api.mapbox.com` URLs, it answers from route keys `directions/walking`,
  `directions/cycling` and `searchbox/forward`. A missing key means HTTP 500, like
  today. For other URLs, the query string is stripped before matching.
- Test: `frontend/src/trip/directions.test.ts`, `frontend/src/trip/search.test.ts`

**Interfaces:**
- Produces, `directions.ts`:
  - `class RouteError extends Error`
  - `fetchLeg(token: string, mode: 'walk' | 'bike', from: LngLat, to: LngLat, signal?: AbortSignal): Promise<Leg>`
    - `walk` maps to the `walking` profile and `bike` to `cycling`
    - it reads `routes[0].duration`, `.distance` and `.geometry`
    - an empty `routes`, a non-OK response or a bad shape gives `RouteError`
    - results are cached; failed promises are evicted
  - `clearLegCache(): void` (for tests)
- Produces, `search.ts`:
  - `class SearchError extends Error`
  - `searchPlaces(token: string, query: string, proximity: LngLat, signal?: AbortSignal): Promise<Place[]>`
    - `name` comes from `properties.name`, `detail` from
      `properties.place_formatted ?? properties.full_address ?? ''`, and `at` from
      `geometry.coordinates`
    - results outside `insideLjubljana` are dropped
    - cached per `query.trim().toLowerCase()`; failed promises are evicted
  - `matchStations(query: string, stations: Station[]): Place[]`
    - case- and diacritic-insensitive substring match on the station name
    - at most 5 results
    - `name` is `titleCase(station.name)`, `detail` is `'BicikeLJ station'`
  - `clearSearchCache(): void`

- [ ] **Step 1: Write the failing tests**

- `fetchLeg` builds exactly the Directions URL from Global Constraints. Assert on
  `fetch.mock.calls[0][0]`. Coordinates are `lon,lat`.
- It parses duration, distance and geometry into a `Leg` with the right `mode`.
- A second identical call makes no second fetch.
- HTTP 500 rejects with `RouteError`, and the next call fetches again.
- `searchPlaces` URL contains `/search/searchbox/v1/forward`, `auto_complete=true`,
  `country=si`, `limit=5`, `language=sl`, `bbox=` plus the `LJUBLJANA_BBOX` values
  joined by commas, and `proximity=14.5058,46.0569`. It does not contain `suggest` or
  `session_token`.
- A feature at Kranj in the response is dropped.
- `matchStations('presernov', META.stations)` returns `Prešernov Trg-Petkovškovo Nabrežje`
  (Review Focus 4). `matchStations('xyz', …)` returns `[]`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/trip/directions src/trip/search`

- [ ] **Step 3: Implement both modules and the `mockFetch` extension**

Normalise with `s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.

- [ ] **Step 4: Run all tests and confirm they pass**

Run: `npm test && npm run typecheck`
Existing tests must still pass with the extended `mockFetch`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(trip): Mapbox directions and free place-search clients"
```

---

### Task 7: `useTrip` hook

**Files:**
- Create: `frontend/src/trip/useTrip.ts`
- Test: `frontend/src/trip/useTrip.test.ts`

**Interfaces:**
- Consumes: `selectStations`, `timeline`, `stationChance`, `THRESHOLD` (Task 5);
  `fetchLeg` (Task 6); `ljubljanaInstant` (Task 4).
- Produces:

```ts
export type TripState =
  | { status: 'idle' }                       // from or to missing
  | { status: 'loading' }                    // debouncing, waiting for profiles, or fetching legs
  | { status: 'error'; retry: () => void }   // a Directions leg failed
  | { status: 'ready'; result: TripResult };
export function useTrip(token: string, inputs: TripInputs, meta: Meta | null,
  profiles: Partial<Record<Day, Profile>>): TripState;
```

**Behaviour:**
- `idle` when `from` or `to` is null.
- Otherwise `loading` until 300 ms have passed with no input change, and until `meta`
  and all 7 `mon`…`sun` profiles are present.
- Then run `selectStations` with `time = ljubljanaInstant(date, time)` and
  `holidays = new Set(meta.holidays)`:
  - **`no-station`** → `ready` with that result, with no fetches.
  - **`walk`** → fetch one `walk` leg from→to. Leave at: `depart = time`. Arrive by:
    `arrive = time`.
  - **`bike`** → fetch the 3 legs in parallel. Build `timeline` from the real
    durations. Recompute `pickup` and `dropoff` with `stationChance` at the real
    `atPickup` and `atDropoff`, and set `acceptable` against `THRESHOLD[risk]`. Do not
    re-select stations. Set `limitedData` from the `days_used` of the profiles that
    `profileSlot` picks for those two moments, compared with `LIMITED_DATA_DAYS`
    (exported by `controls/TypicalPanel.tsx`).
- Any new input aborts the in-flight requests (`AbortController`). A response for
  superseded inputs must never be set.
- `retry` re-runs the same inputs.

- [ ] **Step 1: Write the failing tests**

Use `vi.useFakeTimers({ shouldAdvanceTime: true })`, `renderHook`, the Task 6
`mockFetch` with walking `duration: 300` and cycling `duration: 600`, and `META`
plus 7 fixture profiles.
- `idle` with no `to`.
- Leave at 05:00 with Safe: a `bike` result where
  `depart = 05:00`, `arrive = depart + 300 + 60 + 600 + 60 + 300 s`, `legs` modes are
  `['walk','bike','walk']`, and `pickup.acceptable` is true.
- Arrive by 05:30: `arrive` is 05:30 and `depart` is 05:30 − 1320 s.
- Debounce: two input changes 100 ms apart make only one set of fetches.
- **Stale response (Review Focus 3):** the first fetch is held on a deferred promise,
  then the inputs change, then the second resolves, then the first resolves. The
  final result matches the second inputs.
- Cycling HTTP 500: `status: 'error'`. Fix the route, call `retry()`, and the result
  is `ready`.
- A `mon` profile with `days_used: 1.2` and a Monday trip: `limitedData` is true.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/trip/useTrip`

- [ ] **Step 3: Implement `useTrip.ts`**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/trip && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/trip
git commit -m "feat(trip): useTrip hook builds the planned route"
```

---

### Task 8: `StationMap`: route overlay, boundary, map picking and trip colours

**Files:**
- Modify: `frontend/src/map/StationMap.tsx`
- Test: `frontend/src/map/StationMap.test.tsx` (extend the mapbox mock with `click`
  handler capture, `addLayer` recording, a `getSource` that returns `{ setData }`,
  and `setLayoutProperty`)

**Interfaces:**
- Consumes: `TripResult`, `LngLat` (Task 3); `LJUBLJANA_BOUNDARY` (Task 3).
- Produces new **required** props on `StationMapProps`:
  - `trip: TripResult | null`
  - `endpoints: { from: LngLat | null; to: LngLat | null }`
  - `showBoundary: boolean`
  - `onPick: ((at: LngLat) => void) | null`

**Behaviour:**
- **Sources:** `route` (LineStrings with property `leg: 'walk' | 'bike'`), `endpoints`
  (Points with property `role: 'from' | 'to'`), and `boundary`. All are added on load.
- **Layers:**
  - Route layers go **below** the `stations` layer; `endpoints` goes above it.
  - `boundary`: a dashed line in `#5f6368` at opacity 0.6. Visibility follows
    `showBoundary`.
  - `route-walk`: `#5f6368`, width 3, `line-dasharray [0.5, 2]`, round caps.
  - `route-bike`: `#0b7a75`, width 5.
  - `endpoints`: circle radius 7 with a white stroke of 2; `from` is `#1a73e8` and
    `to` is `#d93025`.
- **While `trip` is a `bike` or `walk` result:**
  - set the route data and `fitBounds` to all leg coordinates (padding 60)
  - every station gets feature-state `faded: true`. `circle-opacity` and
    `circle-stroke-opacity` become 0.25 when faded.
  - for `bike`: the pickup and drop-off get `faded: false`, `p: 1 − chance`
    (`NO_DATA_P` if null) and `selected: true`
  - the profile/slot/mode recolouring must not overwrite those values. Do it all in
    the one recolour effect, which now also depends on `trip`.
  - Clearing `trip` restores every station's state.
- **Clicks:**
  - if `onPick` is set, call it with `{ lon: e.lngLat.lng, lat: e.lngLat.lat }` and
    don't select
  - else if a `bike` or `walk` trip is shown, ignore station clicks
  - else, as today
  - Read `onPick` and `trip` through refs, like `onSelectRef`.

- [ ] **Step 1: Write the failing tests**

- With `onPick` set, a captured click with `lngLat {lng: 14.5, lat: 46.05}` calls
  `onPick({lon:14.5, lat:46.05})` and not `onSelect`.
- With a `bike` trip and no `onPick`, a click calls neither.
- With no trip, the existing behaviour is unchanged (the old tests still pass).
- After load, `addLayer` was called for `route-walk`, `route-bike`, `endpoints` and
  `boundary`, and `route-*` was called with `beforeId === 'stations'`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/map`

- [ ] **Step 3: Implement**

Update `App.tsx`'s `<StationMap>` call with neutral values (`trip={null}`,
`endpoints={{from:null,to:null}}`, `showBoundary={false}`, `onPick={null}`), so
typecheck passes until Task 10.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(map): route overlay, Ljubljana boundary and map picking"
```

---

### Task 9: Trip UI components

**Files:**
- Create: `frontend/src/trip/PlaceField.tsx`, `frontend/src/trip/TripSearch.tsx`,
  `frontend/src/trip/TripResultView.tsx`
- Modify: `frontend/src/styles.css` (new `.trip-*` rules, matching the existing
  variables `--accent`, `--line`, `--radius` and `--shadow`; touch targets ≥ 44 px on
  mobile)
- Test: `frontend/src/trip/TripSearch.test.tsx`, `frontend/src/trip/TripResultView.test.tsx`

**Interfaces:**
- Consumes: `searchPlaces`, `matchStations` (Task 6); `insideLjubljana`,
  `LJUBLJANA_CENTER` (Task 3); `tripDates`, `formatDateOption`, `formatClock` (Task 4);
  `TripState` (Task 7); `colorFor` (`data/colors.ts`).
- Produces:

```ts
// PlaceField.tsx
export interface PlaceFieldProps {
  label: 'From' | 'To'; value: Place | null; onChange: (p: Place | null) => void;
  stations: Station[]; token: string; allowMyLocation: boolean;
  onChooseOnMap: () => void; onNotice: (msg: string) => void;
}
// TripSearch.tsx
export interface TripSearchProps {
  inputs: TripInputs; onInputs: (next: TripInputs) => void;
  open: boolean; onOpen: () => void; onClose: () => void;   // onClose clears the trip
  collapsible: boolean;              // true on mobile: closed shows only the "Where to?" pill
  pickTarget: 'from' | 'to' | null; onPickTarget: (t: 'from' | 'to' | null) => void;
  stations: Station[]; token: string; now: Date;
  onNotice: (msg: string) => void; children?: ReactNode;    // desktop: result rendered inside the card
}
// TripResultView.tsx
export interface TripResultViewProps { state: TripState; inputs: TripInputs }
```

**Behaviour:**
- **`PlaceField`:**
  - A text input labelled `From`/`To` that shows the selected place's name.
  - On focus or typing, a listbox shows, in order:
    1. `My location` (if `allowMyLocation`)
    2. `Choose on map`
    3. `matchStations` results, immediately
    4. `searchPlaces` results, after a 400 ms pause, only from 3 characters
  - If search fails, the listbox shows a `Search unavailable` row.
  - **My location:** uses `navigator.geolocation.getCurrentPosition`.
    - outside the boundary: `onNotice('Pick a point inside Ljubljana')`
    - on error: `onNotice("Couldn't get your location")`
    - otherwise: `{ name: 'My location', detail: '', at }`
  - **Choose on map:** calls `onChooseOnMap`.
- **`TripSearch`:**
  - When `collapsible && !open`, it renders only a button `Where to?`.
  - Otherwise it renders:
    - the two `PlaceField`s
    - a swap button (`aria-label="Swap"`)
    - a `Leave at`/`Arrive by` toggle (`aria-pressed`)
    - the time input (`aria-label="Time"`)
    - a date `<select>` (`aria-label="Date"`) with options from `tripDates(now)`
    - a `Safe`/`Risky` toggle
    - a close button (`aria-label="Close trip"`) that calls `onClose`
    - `children`
  - While `pickTarget` is set, it shows the hint `Tap the map to set the start` or
    `Tap the map to set the destination`.
- **`TripResultView`:**
  - **`loading`:** `Planning…`
  - **`error`:** `Couldn't get the route.` and a `Retry` button
  - **`no-station`:** `No station within 1 km of the start` / `of the end`
  - **`walk`:**
    - `Walking is faster`
    - the header `{formatClock(depart)} → {formatClock(arrive)}` with the total minutes
    - one row, `Walk N min to {inputs.to.name}`
  - **`bike`:**
    - the header as above, plus `Leave by {depart} to arrive by {time}` for Arrive by
    - three rows:
      - `Walk N min to {pickup}` with the bike chance label
      - `Ride N min to {dropoff}` with the dock chance label
      - `Walk N min to {inputs.to.name}`
    - Station names are `titleCase`d.
    - The chance labels follow Global Constraints. A not-acceptable station gets the
      class `warn`.
    - When `limitedData` is true, it shows the muted note `Limited data` under the
      header.
  - Minutes are `Math.max(1, Math.round(s / 60))`.

- [ ] **Step 1: Write the failing tests**

- **`TripSearch`, collapsible and closed:** only `Where to?` is shown, and clicking it
  calls `onOpen`.
- **Open:**
  - typing `pres` into `To` lists `Prešernov Trg-Petkovškovo Nabrežje`; clicking it
    calls `onInputs` with `to.name` set to it
  - typing `kolodvor` and advancing 400 ms makes one `searchbox/forward` fetch
  - a search HTTP 500 shows `Search unavailable`
- `My location` with a geolocation stub at Kranj calls
  `onNotice('Pick a point inside Ljubljana')`, and `onInputs` is not called.
- The `Arrive by` toggle sets `timeMode: 'arrive'`; `Risky` sets `risk: 'risky'`.
- Swap exchanges `from` and `to`.
- **`TripResultView`, bike:**
  - legs of 300, 600 and 300 s render `Walk 5 min to`, `Ride 10 min to` and
    `Walk 5 min to`
  - a chance of 0.95 renders `Bike likely · 9 in 10`
  - a chance of 0.4 with `acceptable:false` renders `Free dock unlikely · 4 in 10`
    with class `warn`
  - for Arrive by, `Leave by 5:08 AM to arrive by 5:30 AM` renders
- **`no-station` and `error`:** the texts render, and `Retry` calls `retry`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/trip/Trip`

- [ ] **Step 3: Implement the three components and their styles**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(trip): search card, place fields and result view"
```

---

### Task 10: App wiring, layout and final checks

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/main.tsx`
  (pass `now={new Date()}`)
- Test: `frontend/src/App.test.tsx`. Extend the `StationMap` stub: when `onPick` is
  set, render buttons `pick inside` (calls `onPick({lon:14.5058, lat:46.0569})`) and
  `pick outside` (calls `onPick({lon:14.3556, lat:46.2389})`). Render
  `data-testid="trip-kind"` with `trip?.kind ?? 'none'`.

**Interfaces:**
- Consumes: everything above.
- `App` gains a prop `now: Date`.
- New state in `App`:
  - `tripInputs: TripInputs`, initialised from `defaultTripTime(now)`, Leave at, Safe,
    no points
  - `tripOpen: boolean`
  - `pickTarget: 'from' | 'to' | null`
  - `notice: string | null`

**Behaviour:**
- `const trip = useTrip(mapboxToken, tripInputs, meta, profiles)`
- `planning = trip.status !== 'idle'`
- **The availability panel** (`TypicalPanel`) is not rendered while `planning`, on
  both layouts.
- **Mobile:**
  - `TripSearch` with `collapsible` is absolutely positioned at the top of the map
    area (z-index above the map).
  - While `planning`, `TripResultView` renders where the panel was, docked at the
    bottom (`order: 3`).
  - The station `BottomSheet` is hidden while `planning`.
- **Desktop:**
  - A left column (`.side`, absolute, top 12 px, left 12 px, width 440 px, flex
    column, gap 8 px) holds `TripSearch` (not collapsible, always open), then the
    `TypicalPanel`.
  - `TripResultView` is passed as `children` of `TripSearch`.
  - `.panel` loses its own absolute positioning on desktop; `.side` owns it.
- **StationMap props:**
  - `trip`: the result when `trip.status === 'ready'`, else `null`
  - `endpoints`: from `tripInputs`
  - `showBoundary`: `(!desktop && tripOpen) || pickTarget !== null || from !== null || to !== null`.
    It is hidden on desktop until the user starts a trip, so the always-open card
    doesn't permanently draw the outline.
- **Data not loading:** while `planning` and `allStatus === 'error'`, render
  `Couldn't load data.` with a `Retry` button (calls `useTypical`'s `retry`) in place
  of `TripResultView`. Without this, a failed background prefetch would leave
  `Planning…` forever.
  - `onPick`: while `pickTarget` is set, it checks `insideLjubljana`:
    - inside: sets that field to `{ name: 'Point on map', detail: '', at }` and clears
      `pickTarget`
    - outside: sets the notice to `Pick a point inside Ljubljana` and keeps
      `pickTarget`
- When a trip result becomes `ready`, clear `selectedId`.
- **Closing the card** (`onClose`) sets `from` and `to` to null, `pickTarget` to null
  and `tripOpen` to false. The panel returns.
- **The notice** renders as `<div role="alert" className="toast">` and clears after
  3000 ms. Use `role="alert"`, not `status`: the existing tests use `role="status"` to
  detect loading.

- [ ] **Step 1: Write the failing tests**

All on mobile (`setViewport('mobile')`) unless stated:
- `Where to?` is visible, and so is the panel.
- Open, then `To` → `Choose on map`, then `pick outside`. The alert says
  `Pick a point inside Ljubljana`, and `trip-kind` is `none`.
- Set `From` → `Choose on map` → `pick inside`, and `To` by station match
  `Kongresni`. After 300 ms, `trip-kind` is not `none`, the `Typical availability`
  region is gone, and the result shows `Walking is faster`. With the pinned constants,
  walking from the centre to Kongresni trg is estimated at 777 s, and the best bike
  pair at 804 s.
- `Close trip` brings back the `Typical availability` region, and `trip-kind` is `none`.
- With `routes['sun.json'] = FAIL`, a planned trip shows `Couldn't load data.`. Fix the
  route and click `Retry`, and the trip result appears.
- **Desktop:** the trip card and the `Typical availability` region are both visible,
  and there is no `Where to?` pill.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/App`

- [ ] **Step 3: Implement the wiring and layout**

- [ ] **Step 4: Run the full check**

Run: `npm test && npm run typecheck && VITE_MAPBOX_TOKEN=pk.x VITE_DATA_BASE_URL=/dev-data/v1/ npm run build`
Expected: all tests pass, there are no type errors and the build succeeds.

- [ ] **Step 5: Manual check against synthetic data**

Run: `npm run fake-data && npm run dev`, with `.env.local` holding a real public
token and `VITE_DATA_BASE_URL=/dev-data/v1/`. On a 390 px-wide viewport, check:
- Plan Home → train station for Arrive by 05:30 tomorrow. A route draws, with
  walking legs dotted and the bike leg solid. Other stations are faded. The panel is
  hidden.
- A point outside the dashed boundary is refused.
- Switching to Risky can pick a closer pickup.
- The holiday date written by fake-data (2 days ahead) plans without errors.

Write down anything that looks off. Don't fix it silently.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): trip planner in the app"
```
