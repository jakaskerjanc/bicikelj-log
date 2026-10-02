# Typical Availability Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, mobile-friendly Mapbox web app on GitHub Pages that colours every BicikeLJ station by its typical chance of being empty (bikes mode) or full (docks mode) for a chosen weekday and 15-minute slot, with a per-station daily chart.

**Architecture:** Pure logic lives in `frontend/src/data/`:
- time slots (`slots.ts`)
- colour buckets (`colors.ts`)
- station helpers (`stations.ts`)
- fetching and validation of the published JSON (`api.ts`)
- a React hook that loads and caches the profiles (`useTypical.ts`)

React components handle the control panel, the station detail and the chart. `StationMap` is a thin imperative mapbox-gl wrapper: one GeoJSON source and one circle layer, coloured through `feature-state`. `App` owns four pieces of state (day, slot, mode, selected station). A GitHub Actions workflow tests the app, builds it and deploys it to Pages.

**Tech Stack:** Node 24, Vite 8, React 19, TypeScript, mapbox-gl 3. Tests use Vitest 5, jsdom and React Testing Library.

**Paths:** All paths are relative to the repo root. All `npm` commands run in `frontend/` (`cd frontend` first).

**Spec:** `docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md`. Read it before starting. The data contract it consumes is in `docs/superpowers/specs/2026-09-23-typical-availability-design.md`, section "Output contract".

## Global Constraints

- English UI only. Times use the 24-hour clock (`"09:00"`). The label format is `"Monday, 09:00"`.
- Day chips run Monday first: `M T W T F S S`. Profiles are `mon`…`sun` only. The `holiday` profile is never fetched or shown.
- "Now" is always computed in `Europe/Ljubljana`, whatever the device timezone. Slot = `hour*4 + floor(minute/15)`, in the range 0–95.
- Colour value: `p_empty` in bikes mode, `p_full` in docks mode. Buckets:
  - `< 0.10` → `#1ea362`
  - `< 0.30` → `#f2c12e`
  - `< 0.60` → `#f26b3a`
  - otherwise → `#a3201d`
  - `null` → `#9aa0a6`
- Legend words: "Available" … "Empty" in bikes mode, "Available" … "Full" in docks mode.
- "Limited data" is shown when the selected profile has `days_used < 2`.
- Breakpoint: `(min-width: 640px)`.
  - Desktop: floating panel at the top left, Mapbox popup for the station, 96-bar chart.
  - Mobile: panel docked at the bottom, bottom sheet for the station, 24-bar hourly chart. Touch targets are at least 44 px.
- Build env: `VITE_MAPBOX_TOKEN` and `VITE_DATA_BASE_URL`. `vite build` fails if either is missing. `dev` and Vitest do not check them.
- Vite `base: '/bicikelj-log/'`. Map style: `mapbox://styles/mapbox/light-v11`.
- Runtime dependencies: `react`, `react-dom` and `mapbox-gl` only. No state library, UI kit or validation library.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. It is omitted from the commit commands below for brevity, but add it to every commit.

## Review Focus

1. **The device is not in Ljubljana time, or it is just after midnight.** At 22:30 UTC on Sunday 4 Oct 2026 it is already Monday 00:30 in Ljubljana. The app must open on Monday, slot 2. Test: `nowInLjubljana › uses Ljubljana time, not device or UTC time` (Task 2).
2. **A new station appears in `meta` but is missing from the profile.** It must render grey with "No data for this time" and 96 grey stub bars, not crash. Tests: `stationFeatureStates › station missing from profile is null` (Task 3) and `StationDetail › station missing from profile shows no data` (Task 6).
3. **A background prefetch failed, and the user then selects that day.** The day must be fetched again. It must not get stuck in "loading" or "error". Test: `useTypical › a day whose prefetch failed is fetched again when selected` (Task 4).
4. **`DATA_BASE_URL` is set without a trailing slash.** For example `…/typical/v1`. It must still request `…/typical/v1/meta.json`. Test: `api › base URL without trailing slash` (Task 4).
5. **The hourly mobile chart at the end of the day, with partial nulls.** Slot 95 must highlight hour 23, and an hour with some null slots averages only the non-null ones. Tests: `hourly › ignores nulls…` (Task 2) and `DayChart › compact highlights hour 23 at slot 95` (Task 6).

---

### Task 1: Scaffold the frontend project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/config.ts`
- Create: `frontend/src/main.tsx` (temporary content, replaced in Task 7)
- Create: `frontend/src/data/types.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/test/viewport.ts`
- Test: `frontend/src/data/types.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces, in `src/data/types.ts`:
  - `DAYS` (readonly tuple `'mon'…'sun'`)
  - `type Day`, `type Mode = 'bikes' | 'docks'`
  - `SLOTS_PER_DAY = 96`, `type Series = (number | null)[]`
  - `interface Station { id; name; lat; lon; capacity }`
  - `interface Meta { generated_at: string; stations: Station[] }`
  - `interface StationSeries { bikes; docks; p_empty; p_full: Series }`
  - `interface Profile { profile: Day; days_used: number; stations: Record<string, StationSeries> }`
- Produces, in `src/config.ts`: `MAPBOX_TOKEN: string` and `DATA_BASE_URL: string`.
- Produces, in `src/test/viewport.ts`: `setViewport(v: 'desktop' | 'mobile')` and `installMatchMedia()`. The default is desktop, and it is reset after every test by `setup.ts`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "bicikelj-typical",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "fake-data": "node scripts/fake-data.mjs"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run (in `frontend/`):

```bash
npm install react react-dom mapbox-gl
npm install -D vite @vitejs/plugin-react typescript vitest jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @types/react @types/react-dom @types/node @types/geojson
```

Expected: `package-lock.json` is created. With current versions this resolves to vite 8, vitest 5, react 19 and mapbox-gl 3.

- [ ] **Step 3: Create the config files**

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`frontend/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const REQUIRED_BUILD_ENV = ['VITE_MAPBOX_TOKEN', 'VITE_DATA_BASE_URL'];

export default defineConfig(({ command, mode }) => {
  // Only `vite build` checks: a missing token would ship a blank map. dev and Vitest don't need them.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED_BUILD_ENV.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing build environment variables: ${missing.join(', ')}`);
    }
  }
  return {
    base: '/bicikelj-log/',
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>BicikeLJ — typical availability</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/.env.example`:

```bash
# Copy to .env.local (gitignored). A Mapbox public token restricted to the Pages URL and localhost.
VITE_MAPBOX_TOKEN=pk.your-token
# The backend's publicBaseUrl deploy output, e.g. https://bicikeljpub<unique>.blob.core.windows.net/typical/v1/
# For synthetic local data run `npm run fake-data` and use /bicikelj-log/dev-data/v1/
VITE_DATA_BASE_URL=
```

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`frontend/src/config.ts`:

```ts
// Build-time settings; `vite build` refuses to run without them (see vite.config.ts).
export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
export const DATA_BASE_URL: string = import.meta.env.VITE_DATA_BASE_URL ?? '';
```

`frontend/src/main.tsx` (temporary content; Task 7 replaces it):

```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p>BicikeLJ typical availability</p>);
```

- [ ] **Step 4: Create the shared types**

`frontend/src/data/types.ts`:

```ts
// Shapes of the published typical/v1 JSON (backend spec, "Output contract") and UI enums.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

export type Mode = 'bikes' | 'docks';

export const SLOTS_PER_DAY = 96;

/** One value per 15-minute local slot; null = no data. */
export type Series = (number | null)[];

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

export interface Meta {
  generated_at: string;
  stations: Station[];
}

export interface StationSeries {
  bikes: Series;
  docks: Series;
  p_empty: Series;
  p_full: Series;
}

export interface Profile {
  profile: Day;
  days_used: number;
  stations: Record<string, StationSeries>;
}
```

- [ ] **Step 5: Create the test setup**

`frontend/src/test/viewport.ts`:

```ts
import { vi } from 'vitest';

// jsdom has no matchMedia; this fake answers the app's single "(min-width: 640px)" query.
let desktop = true;

export function setViewport(viewport: 'desktop' | 'mobile'): void {
  desktop = viewport === 'desktop';
}

export function installMatchMedia(): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('min-width') ? desktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installMatchMedia, setViewport } from './viewport';

installMatchMedia();

afterEach(() => {
  cleanup();
  setViewport('desktop');
  vi.unstubAllGlobals();
});
```

- [ ] **Step 6: Write a smoke test**

`frontend/src/data/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAYS, SLOTS_PER_DAY } from './types';

describe('types', () => {
  it('days are Monday first and there are 96 slots', () => {
    expect(DAYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(SLOTS_PER_DAY).toBe(96);
  });
});
```

- [ ] **Step 7: Run the tests, the type check and both build cases**

Run each of the following from `frontend/`:

1. `npm test`
   Expected: PASS (1 test).
2. `npm run typecheck`
   Expected: no output, exit code 0.
3. `env -u VITE_MAPBOX_TOKEN -u VITE_DATA_BASE_URL npx vite build --mode ci-check`
   Expected: it fails with `Missing build environment variables: VITE_MAPBOX_TOKEN, VITE_DATA_BASE_URL`. The `--mode ci-check` flag makes Vite ignore `.env.local`.
4. `npm run build`
   Expected: it succeeds and creates `dist/`, provided `frontend/.env.local` exists with both variables. It already does in the author's checkout.

- [ ] **Step 8: Update `.gitignore`**

The repo `.gitignore` already contains `*.local`, `node_modules/` and `dist/`. Append:

```
frontend/public/dev-data/
```

- [ ] **Step 9: Commit**

```bash
git add .gitignore frontend/package.json frontend/package-lock.json frontend/tsconfig.json \
  frontend/vite.config.ts frontend/index.html frontend/.env.example frontend/src
git commit -m "feat(frontend): scaffold Vite + React + TS app with Vitest"
```

---

### Task 2: Time slots and colour buckets

**Files:**
- Create: `frontend/src/data/slots.ts`
- Create: `frontend/src/data/colors.ts`
- Test: `frontend/src/data/slots.test.ts`
- Test: `frontend/src/data/colors.test.ts`

**Interfaces:**
- Consumes: `Day`, `Mode` and `Series` from `types.ts`.
- Produces, in `slots.ts`:
  - `nowInLjubljana(now?: Date): { day: Day; slot: number }`
  - `slotLabel(slot: number): string`
  - `dayName(day: Day): string`
  - `hourly(values: Series): Series` (always length 24)
  - `TICK_SLOTS = [32, 48, 64, 80] as const`
- Produces, in `colors.ts`:
  - `THRESHOLDS = [0.1, 0.3, 0.6] as const`
  - `BUCKET_COLORS` (4 hex strings, green to dark red)
  - `NO_DATA_COLOR = '#9aa0a6'`
  - `bucket(p: number | null): number | null` (bucket index 0–3)
  - `colorFor(p: number | null): string`
  - `legendLabels(mode: Mode): { low: string; high: string }`

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/slots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayName, hourly, nowInLjubljana, slotLabel } from './slots';

describe('nowInLjubljana', () => {
  it('maps 09:05 Ljubljana time to slot 36', () => {
    // 2026-10-05 07:05 UTC = Monday 09:05 CEST
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 5, 7, 5)))).toEqual({ day: 'mon', slot: 36 });
  });

  it('uses Ljubljana time, not device or UTC time', () => {
    // 2026-10-04 22:30 UTC is still Sunday in UTC but already Monday 00:30 in Ljubljana
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 4, 22, 30)))).toEqual({ day: 'mon', slot: 2 });
  });

  it('handles the spring-forward day', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST at 01:00 UTC
    expect(nowInLjubljana(new Date(Date.UTC(2026, 2, 29, 0, 30)))).toEqual({ day: 'sun', slot: 6 });
    expect(nowInLjubljana(new Date(Date.UTC(2026, 2, 29, 1, 30)))).toEqual({ day: 'sun', slot: 14 });
  });

  it('handles the fall-back day (02:30 happens twice)', () => {
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 25, 0, 30)))).toEqual({ day: 'sun', slot: 10 });
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 25, 1, 30)))).toEqual({ day: 'sun', slot: 10 });
  });
});

describe('slotLabel', () => {
  it('formats 24-hour times', () => {
    expect(slotLabel(0)).toBe('00:00');
    expect(slotLabel(36)).toBe('09:00');
    expect(slotLabel(37)).toBe('09:15');
    expect(slotLabel(95)).toBe('23:45');
  });
});

describe('dayName', () => {
  it('returns the English weekday', () => {
    expect(dayName('mon')).toBe('Monday');
    expect(dayName('sun')).toBe('Sunday');
  });
});

describe('hourly', () => {
  it('averages each group of 4 slots into 24 hours', () => {
    const values = Array.from({ length: 96 }, (_, i) => Math.floor(i / 4) / 100);
    const result = hourly(values);
    expect(result).toHaveLength(24);
    expect(result[0]).toBeCloseTo(0);
    expect(result[23]).toBeCloseTo(0.23);
  });

  it('ignores nulls and returns null for an all-null hour', () => {
    const values: (number | null)[] = Array(96).fill(null);
    values[4] = 0.2; // hour 1: only one real value
    values[7] = 0.4; // hour 1
    expect(hourly(values)[0]).toBeNull();
    expect(hourly(values)[1]).toBeCloseTo(0.3);
  });
});
```

`frontend/src/data/colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BUCKET_COLORS, NO_DATA_COLOR, bucket, colorFor, legendLabels } from './colors';

describe('bucket', () => {
  it.each([
    [0, 0],
    [0.0999, 0],
    [0.1, 1],
    [0.2999, 1],
    [0.3, 2],
    [0.5999, 2],
    [0.6, 3],
    [1, 3],
  ])('p=%s → bucket %s', (p, expected) => {
    expect(bucket(p)).toBe(expected);
  });

  it('null has no bucket', () => {
    expect(bucket(null)).toBeNull();
  });
});

describe('colorFor', () => {
  it('maps buckets to colours and null to grey', () => {
    expect(colorFor(0.05)).toBe(BUCKET_COLORS[0]);
    expect(colorFor(0.7)).toBe(BUCKET_COLORS[3]);
    expect(colorFor(null)).toBe(NO_DATA_COLOR);
  });
});

describe('legendLabels', () => {
  it('says Empty for bikes and Full for docks', () => {
    expect(legendLabels('bikes')).toEqual({ low: 'Available', high: 'Empty' });
    expect(legendLabels('docks')).toEqual({ low: 'Available', high: 'Full' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/data/slots.test.ts src/data/colors.test.ts`
Expected: FAIL. Both modules are missing ("Failed to resolve import './slots'" and "'./colors'").

- [ ] **Step 3: Implement**

`frontend/src/data/slots.ts`:

```ts
import type { Day, Series } from './types';

const DAY_NAMES: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** Slots that get a tick label under the slider and the chart: 08:00, 12:00, 16:00, 20:00. */
export const TICK_SLOTS = [32, 48, 64, 80] as const;

const LJUBLJANA_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Ljubljana',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Current weekday and 15-minute slot in Ljubljana, whatever the device timezone. */
export function nowInLjubljana(now: Date = new Date()): { day: Day; slot: number } {
  const parts = Object.fromEntries(LJUBLJANA_CLOCK.formatToParts(now).map((p) => [p.type, p.value]));
  const day = parts.weekday.toLowerCase() as Day; // en-GB short weekday: "Mon" … "Sun"
  return { day, slot: Number(parts.hour) * 4 + Math.floor(Number(parts.minute) / 15) };
}

export function slotLabel(slot: number): string {
  const minutes = slot * 15;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function dayName(day: Day): string {
  return DAY_NAMES[day];
}

/** 96 quarter-hour values → 24 hourly means; nulls are ignored, an all-null hour is null. */
export function hourly(values: Series): Series {
  return Array.from({ length: 24 }, (_, hour) => {
    const known = values.slice(hour * 4, hour * 4 + 4).filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  });
}
```

`frontend/src/data/colors.ts`:

```ts
import type { Mode } from './types';

/** Lower bounds of buckets 1..3 for p (chance empty / full). Bucket 0 is everything below 0.1. */
export const THRESHOLDS = [0.1, 0.3, 0.6] as const;
export const BUCKET_COLORS = ['#1ea362', '#f2c12e', '#f26b3a', '#a3201d'] as const;
export const NO_DATA_COLOR = '#9aa0a6';

export function bucket(p: number | null): number | null {
  if (p === null) return null;
  let i = 0;
  while (i < THRESHOLDS.length && p >= THRESHOLDS[i]) i++;
  return i;
}

export function colorFor(p: number | null): string {
  const b = bucket(p);
  return b === null ? NO_DATA_COLOR : BUCKET_COLORS[b];
}

export function legendLabels(mode: Mode): { low: string; high: string } {
  return { low: 'Available', high: mode === 'bikes' ? 'Empty' : 'Full' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/data/slots.test.ts src/data/colors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data/slots.ts frontend/src/data/slots.test.ts frontend/src/data/colors.ts frontend/src/data/colors.test.ts
git commit -m "feat(frontend): Ljubljana time slots and colour buckets"
```

---

### Task 3: Station helpers

**Files:**
- Create: `frontend/src/data/stations.ts`
- Create: `frontend/src/test/fixtures.ts`
- Test: `frontend/src/data/stations.test.ts`

**Interfaces:**
- Consumes: `Meta`, `Mode`, `Profile`, `Series`, `SLOTS_PER_DAY` and `DAYS` from `types.ts`.
- Produces, in `stations.ts`:
  - `probabilities(profile: Profile | null, id: string, mode: Mode): Series` (96 values; all null if the station or profile is missing)
  - `counts(profile: Profile | null, id: string, mode: Mode): Series` (`bikes` or `docks`)
  - `stationFeatureStates(meta: Meta, profile: Profile | null, slot: number, mode: Mode): { id: string; p: number | null }[]`
  - `stationsGeoJson(meta: Meta): FeatureCollection<Point, { id: string }>`
  - `titleCase(name: string): string`
  - `formatPercent(p: number | null): string`
- Produces, in `src/test/fixtures.ts`, test data used by Tasks 4–7:
  - `META` (2 stations)
  - `series(value)`, `stationSeries(overrides)`, `makeProfile(day, overrides)`
  - `FAIL` (sentinel), `allRoutes()`
  - `mockFetch(routes)` (a `vi.fn` that serves `routes[filename]`, returns HTTP 500 for `FAIL` or for missing files, and records the requested URLs)

- [ ] **Step 1: Create the shared test fixtures**

`frontend/src/test/fixtures.ts`:

```ts
import { vi } from 'vitest';
import { DAYS, SLOTS_PER_DAY, type Day, type Meta, type Profile, type Series, type StationSeries } from '../data/types';

export const BASE_URL = 'https://data.example/typical/v1/';

export const META: Meta = {
  generated_at: '2026-10-01T01:30:00Z',
  stations: [
    { id: '1', name: 'PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE', lat: 46.0514, lon: 14.506, capacity: 20 },
    { id: '2', name: 'KONGRESNI TRG-ŠUBIČEVA ULICA', lat: 46.05, lon: 14.503, capacity: 22 },
  ],
};

export function series(value: number | null): Series {
  return Array<number | null>(SLOTS_PER_DAY).fill(value);
}

export function stationSeries(overrides: Partial<StationSeries> = {}): StationSeries {
  return { bikes: series(5), docks: series(15), p_empty: series(0.05), p_full: series(0.02), ...overrides };
}

export function makeProfile(day: Day, overrides: Partial<Profile> = {}): Profile {
  return { profile: day, days_used: 4.2, stations: { '1': stationSeries(), '2': stationSeries() }, ...overrides };
}

/** Route value that makes mockFetch answer HTTP 500. */
export const FAIL = Symbol('fail');
export type Routes = Record<string, unknown>;

export function allRoutes(): Routes {
  const routes: Routes = { 'meta.json': META };
  for (const day of DAYS) routes[`${day}.json`] = makeProfile(day);
  return routes;
}

/** fetch stand-in: serves routes[<last path segment>]; FAIL or a missing route → 500. Mutate `routes` to change answers. */
export function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const file = String(input).split('/').pop() ?? '';
    const body = routes[file];
    if (body === undefined || body === FAIL) return new Response('error', { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function requestedFiles(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls.map(([input]) => String(input).split('/').pop() ?? '');
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/data/stations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { META, makeProfile, series, stationSeries } from '../test/fixtures';
import { counts, formatPercent, probabilities, stationFeatureStates, stationsGeoJson, titleCase } from './stations';

describe('probabilities / counts', () => {
  const profile = makeProfile('mon', {
    stations: { '1': stationSeries({ p_empty: series(0.4), p_full: series(0.1), bikes: series(3), docks: series(17) }) },
  });

  it('pick p_empty and bikes in bikes mode', () => {
    expect(probabilities(profile, '1', 'bikes')[0]).toBe(0.4);
    expect(counts(profile, '1', 'bikes')[0]).toBe(3);
  });

  it('pick p_full and docks in docks mode', () => {
    expect(probabilities(profile, '1', 'docks')[0]).toBe(0.1);
    expect(counts(profile, '1', 'docks')[0]).toBe(17);
  });

  it('return 96 nulls for a missing station or profile', () => {
    expect(probabilities(profile, '2', 'bikes')).toEqual(series(null));
    expect(counts(null, '1', 'bikes')).toEqual(series(null));
  });
});

describe('stationFeatureStates', () => {
  it('gives every meta station the value at the slot for the mode', () => {
    const p = series(0.05);
    p[36] = 0.7;
    const profile = makeProfile('mon', { stations: { '1': stationSeries({ p_empty: p }), '2': stationSeries() } });
    expect(stationFeatureStates(META, profile, 36, 'bikes')).toEqual([
      { id: '1', p: 0.7 },
      { id: '2', p: 0.05 },
    ]);
  });

  it('station missing from profile is null', () => {
    const profile = makeProfile('mon', { stations: { '1': stationSeries() } });
    expect(stationFeatureStates(META, profile, 0, 'docks')).toEqual([
      { id: '1', p: 0.02 },
      { id: '2', p: null },
    ]);
  });

  it('no profile yet → all null', () => {
    expect(stationFeatureStates(META, null, 0, 'bikes').map((s) => s.p)).toEqual([null, null]);
  });
});

describe('stationsGeoJson', () => {
  it('builds one point per station with lon/lat order and the id as a property', () => {
    const fc = stationsGeoJson(META);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.coordinates).toEqual([14.506, 46.0514]);
    expect(fc.features[0].properties).toEqual({ id: '1' });
  });
});

describe('titleCase', () => {
  it('converts GBFS uppercase names, including Slovenian letters and hyphens', () => {
    expect(titleCase('PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE')).toBe('Prešernov Trg-Petkovškovo Nabrežje');
  });
});

describe('formatPercent', () => {
  it('rounds to an integer percent', () => {
    expect(formatPercent(0.123)).toBe('12 %');
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(null)).toBe('no data');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/data/stations.test.ts`
Expected: FAIL with "Failed to resolve import './stations'".

- [ ] **Step 4: Implement**

`frontend/src/data/stations.ts`:

```ts
import type { FeatureCollection, Point } from 'geojson';
import { SLOTS_PER_DAY, type Meta, type Mode, type Profile, type Series } from './types';

const NO_DATA: Series = Array<number | null>(SLOTS_PER_DAY).fill(null);

/** Chance the station is empty (bikes mode) or full (docks mode), per slot. */
export function probabilities(profile: Profile | null, id: string, mode: Mode): Series {
  return profile?.stations[id]?.[mode === 'bikes' ? 'p_empty' : 'p_full'] ?? NO_DATA;
}

/** Typical bikes (bikes mode) or free docks (docks mode), per slot. */
export function counts(profile: Profile | null, id: string, mode: Mode): Series {
  return profile?.stations[id]?.[mode === 'bikes' ? 'bikes' : 'docks'] ?? NO_DATA;
}

/** Per-station value the map colours by. Stations missing from the profile are null (grey). */
export function stationFeatureStates(
  meta: Meta,
  profile: Profile | null,
  slot: number,
  mode: Mode,
): { id: string; p: number | null }[] {
  return meta.stations.map((s) => ({ id: s.id, p: probabilities(profile, s.id, mode)[slot] }));
}

export function stationsGeoJson(meta: Meta): FeatureCollection<Point, { id: string }> {
  return {
    type: 'FeatureCollection',
    features: meta.stations.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id },
    })),
  };
}

/** GBFS names are UPPERCASE: "PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE" → "Prešernov Trg-Petkovškovo Nabrežje". */
export function titleCase(name: string): string {
  return name
    .toLocaleLowerCase('sl')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('sl'));
}

export function formatPercent(p: number | null): string {
  return p === null ? 'no data' : `${Math.round(p * 100)} %`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/data/stations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/data/stations.ts frontend/src/data/stations.test.ts frontend/src/test/fixtures.ts
git commit -m "feat(frontend): station helpers and shared test fixtures"
```

---

### Task 4: Fetching, validation and the `useTypical` hook

**Files:**
- Create: `frontend/src/data/api.ts`
- Create: `frontend/src/data/useTypical.ts`
- Test: `frontend/src/data/api.test.ts`
- Test: `frontend/src/data/useTypical.test.ts`

**Interfaces:**
- Consumes: the types from `types.ts`, plus `BASE_URL`, `META`, `makeProfile`, `series`, `stationSeries`, `FAIL`, `allRoutes`, `mockFetch` and `requestedFiles` from `src/test/fixtures.ts`.
- Produces, in `api.ts`:
  - `class DataError extends Error`
  - `parseMeta(x: unknown): Meta`
  - `parseProfile(x: unknown, day: Day): Profile`
  - `fetchMeta(baseUrl: string): Promise<Meta>`
  - `fetchProfile(baseUrl: string, day: Day): Promise<Profile>`
- Produces, in `useTypical.ts`:
  - `type LoadStatus = 'loading' | 'ready' | 'error'`
  - `useTypical(baseUrl: string, day: Day): { meta: Meta | null; profile: Profile | null; status: LoadStatus; retry: () => void }`

- [ ] **Step 1: Write the failing API tests**

`frontend/src/data/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BASE_URL, META, makeProfile, mockFetch, series, stationSeries } from '../test/fixtures';
import type { StationSeries } from './types';
import { DataError, fetchMeta, fetchProfile, parseMeta, parseProfile } from './api';

describe('parseMeta', () => {
  it('accepts a valid document and ignores extra fields', () => {
    expect(parseMeta({ ...META, timezone: 'Europe/Ljubljana', slot_minutes: 15 })).toEqual(META);
  });

  it('rejects a station without coordinates', () => {
    const bad = { ...META, stations: [{ id: '1', name: 'X', capacity: 20 }] };
    expect(() => parseMeta(bad)).toThrow(DataError);
  });
});

describe('parseProfile', () => {
  it('accepts a valid document', () => {
    const doc = makeProfile('mon');
    expect(parseProfile(doc, 'mon')).toEqual(doc);
  });

  it('rejects an array that is not 96 long', () => {
    const doc = makeProfile('mon', { stations: { '1': stationSeries({ bikes: series(5).slice(0, 95) }) } });
    expect(() => parseProfile(doc, 'mon')).toThrow(DataError);
  });

  it('rejects a station missing a field', () => {
    const partial: Partial<StationSeries> = stationSeries();
    delete partial.p_full;
    const doc = { profile: 'mon', days_used: 1, stations: { '1': partial } };
    expect(() => parseProfile(doc, 'mon')).toThrow(DataError);
  });

  it('rejects a document for a different day', () => {
    expect(() => parseProfile(makeProfile('tue'), 'mon')).toThrow(DataError);
  });
});

describe('fetchMeta / fetchProfile', () => {
  it('request <base>meta.json and <base><day>.json', async () => {
    const fetchFn = mockFetch({ 'meta.json': META, 'wed.json': makeProfile('wed') });
    await fetchMeta(BASE_URL);
    await fetchProfile(BASE_URL, 'wed');
    expect(fetchFn.mock.calls.map(([u]) => String(u))).toEqual([`${BASE_URL}meta.json`, `${BASE_URL}wed.json`]);
  });

  it('base URL without trailing slash', async () => {
    const fetchFn = mockFetch({ 'meta.json': META });
    await fetchMeta('https://data.example/typical/v1');
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://data.example/typical/v1/meta.json');
  });

  it('turn HTTP errors into DataError', async () => {
    mockFetch({});
    await expect(fetchMeta(BASE_URL)).rejects.toThrow(DataError);
  });

  it('turn non-JSON bodies into DataError', async () => {
    const fetchFn = mockFetch({});
    fetchFn.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(fetchMeta(BASE_URL)).rejects.toThrow(DataError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/data/api.test.ts`
Expected: FAIL with "Failed to resolve import './api'".

- [ ] **Step 3: Implement `api.ts`**

`frontend/src/data/api.ts`:

```ts
import { SLOTS_PER_DAY, type Day, type Meta, type Profile, type Series, type Station, type StationSeries } from './types';

/** Any failure to fetch or understand a published document. */
export class DataError extends Error {
  override name = 'DataError';
}

const FIELDS = ['bikes', 'docks', 'p_empty', 'p_full'] as const;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isSeries(x: unknown): x is Series {
  return (
    Array.isArray(x) &&
    x.length === SLOTS_PER_DAY &&
    x.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))
  );
}

function isStation(x: unknown): x is Station {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.lat === 'number' &&
    typeof x.lon === 'number' &&
    typeof x.capacity === 'number'
  );
}

export function parseMeta(x: unknown): Meta {
  if (!isObject(x) || typeof x.generated_at !== 'string' || !Array.isArray(x.stations) || !x.stations.every(isStation)) {
    throw new DataError('meta.json: unexpected shape');
  }
  return {
    generated_at: x.generated_at,
    stations: x.stations.map(({ id, name, lat, lon, capacity }) => ({ id, name, lat, lon, capacity })),
  };
}

export function parseProfile(x: unknown, day: Day): Profile {
  const bad = new DataError(`${day}.json: unexpected shape`);
  if (!isObject(x) || x.profile !== day || typeof x.days_used !== 'number' || !isObject(x.stations)) throw bad;
  for (const s of Object.values(x.stations)) {
    if (!isObject(s) || !FIELDS.every((f) => isSeries(s[f]))) throw bad;
  }
  return { profile: day, days_used: x.days_used, stations: x.stations as Record<string, StationSeries> };
}

function fileUrl(baseUrl: string, file: string): string {
  return (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) + file;
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new DataError(`${url}: network error`, { cause });
  }
  if (!res.ok) throw new DataError(`${url}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new DataError(`${url}: not JSON`, { cause });
  }
}

export async function fetchMeta(baseUrl: string): Promise<Meta> {
  return parseMeta(await getJson(fileUrl(baseUrl, 'meta.json')));
}

export async function fetchProfile(baseUrl: string, day: Day): Promise<Profile> {
  return parseProfile(await getJson(fileUrl(baseUrl, `${day}.json`)), day);
}
```

- [ ] **Step 4: Run the API tests to verify they pass**

Run: `npm test -- src/data/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hook tests**

`frontend/src/data/useTypical.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_URL, FAIL, allRoutes, makeProfile, mockFetch, requestedFiles } from '../test/fixtures';
import type { Day } from './types';
import { useTypical } from './useTypical';

function render(day: Day) {
  return renderHook(({ d }) => useTypical(BASE_URL, d), { initialProps: { d: day } });
}

describe('useTypical', () => {
  it('loads meta and the selected profile, then prefetches the other six days', async () => {
    const fetchFn = mockFetch(allRoutes());
    const { result } = render('mon');
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.meta?.stations).toHaveLength(2);
    expect(result.current.profile?.profile).toBe('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    expect(requestedFiles(fetchFn).slice(0, 2).sort()).toEqual(['meta.json', 'mon.json']);
  });

  it('switching to a prefetched day does not fetch again', async () => {
    const fetchFn = mockFetch(allRoutes());
    const { result, rerender } = render('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    rerender({ d: 'wed' });
    await waitFor(() => expect(result.current.profile?.profile).toBe('wed'));
    expect(result.current.status).toBe('ready');
    expect(fetchFn).toHaveBeenCalledTimes(8);
  });

  it('reports an error, and retry fetches the failed file again', async () => {
    const routes = allRoutes();
    routes['mon.json'] = FAIL;
    mockFetch(routes);
    const { result } = render('mon');
    await waitFor(() => expect(result.current.status).toBe('error'));
    routes['mon.json'] = makeProfile('mon');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('a malformed profile is an error, not a partial render', async () => {
    const routes = allRoutes();
    routes['mon.json'] = { profile: 'mon', days_used: 1, stations: { '1': { bikes: [1] } } };
    mockFetch(routes);
    const { result } = render('mon');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.profile).toBeNull();
  });

  it('a day whose prefetch failed is fetched again when selected', async () => {
    const routes = allRoutes();
    routes['wed.json'] = FAIL;
    const fetchFn = mockFetch(routes);
    const { result, rerender } = render('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    expect(result.current.status).toBe('ready'); // failed prefetch is silent
    routes['wed.json'] = makeProfile('wed');
    rerender({ d: 'wed' });
    await waitFor(() => expect(result.current.profile?.profile).toBe('wed'));
    expect(fetchFn).toHaveBeenCalledTimes(9);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- src/data/useTypical.test.ts`
Expected: FAIL with "Failed to resolve import './useTypical'".

- [ ] **Step 7: Implement the hook**

`frontend/src/data/useTypical.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { fetchMeta, fetchProfile } from './api';
import { DAYS, type Day, type Meta, type Profile } from './types';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface TypicalData {
  meta: Meta | null;
  profile: Profile | null;
  status: LoadStatus;
  retry: () => void;
}

/** One promise per file per page load; a failed promise is forgotten so the next request retries. */
function createLoader(baseUrl: string) {
  const cache = new Map<string, Promise<unknown>>();
  function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = fetcher();
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    return promise;
  }
  return {
    meta: () => load('meta', () => fetchMeta(baseUrl)),
    profile: (day: Day) => load(day, () => fetchProfile(baseUrl, day)),
  };
}

export function useTypical(baseUrl: string, day: Day): TypicalData {
  const [loader] = useState(() => createLoader(baseUrl));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [profiles, setProfiles] = useState<Partial<Record<Day, Profile>>>({});
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(false);
    const store = (p: Profile) => setProfiles((prev) => (prev[p.profile] ? prev : { ...prev, [p.profile]: p }));
    Promise.all([loader.meta(), loader.profile(day)]).then(
      ([m, p]) => {
        if (!current) return;
        setMeta(m);
        store(p);
        // Prefetch the other days so switching is instant; a failure here is retried on selection.
        for (const other of DAYS) if (other !== day) loader.profile(other).then(store, () => {});
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [loader, day, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const profile = profiles[day] ?? null;
  const status: LoadStatus = failed ? 'error' : meta && profile ? 'ready' : 'loading';
  return { meta, profile, status, retry };
}
```

- [ ] **Step 8: Run all data tests**

Run: `npm test -- src/data`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/data/api.ts frontend/src/data/api.test.ts frontend/src/data/useTypical.ts frontend/src/data/useTypical.test.ts
git commit -m "feat(frontend): fetch, validate and cache typical profiles"
```

---

### Task 5: Control panel

**Files:**
- Create: `frontend/src/controls/DayChips.tsx`
- Create: `frontend/src/controls/TimeSlider.tsx`
- Create: `frontend/src/controls/ModeToggle.tsx`
- Create: `frontend/src/controls/Legend.tsx`
- Create: `frontend/src/controls/TypicalPanel.tsx`
- Test: `frontend/src/controls/TypicalPanel.test.tsx`

**Interfaces:**
- Consumes: `DAYS`, `Day`, `Mode` and `SLOTS_PER_DAY` (`types.ts`); `dayName`, `slotLabel` and `TICK_SLOTS` (`slots.ts`); `BUCKET_COLORS` and `legendLabels` (`colors.ts`); `LoadStatus` (`useTypical.ts`).
- Produces:
  - `TypicalPanel(props: TypicalPanelProps)`, where `TypicalPanelProps` is `{ day: Day; slot: number; mode: Mode; onDay(day: Day): void; onSlot(slot: number): void; onMode(mode: Mode): void; status: LoadStatus; daysUsed: number | null; onRetry(): void }`
  - `LIMITED_DATA_DAYS = 2`
- Accessible names that tests in Task 7 rely on:
  - the day chips are buttons named by the full day name (`"Monday"`) with `aria-pressed`
  - the slider is `role="slider"`, name `"Time of day"`
  - the mode buttons are named `"Bikes"` and `"Docks"`
  - the panel is a `region` named `"Typical availability"`
  - the retry button is named `"Retry"`

- [ ] **Step 1: Write the failing tests**

`frontend/src/controls/TypicalPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TypicalPanel, type TypicalPanelProps } from './TypicalPanel';

function setup(overrides: Partial<TypicalPanelProps> = {}) {
  const props: TypicalPanelProps = {
    day: 'mon',
    slot: 36,
    mode: 'bikes',
    onDay: vi.fn(),
    onSlot: vi.fn(),
    onMode: vi.fn(),
    status: 'ready',
    daysUsed: 4.2,
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<TypicalPanel {...props} />);
  return props;
}

describe('TypicalPanel', () => {
  it('shows the day and time label', () => {
    setup();
    expect(screen.getByText('Monday, 09:00')).toBeInTheDocument();
  });

  it('day chips read M T W T F S S, Monday first, with the current day pressed', () => {
    setup();
    const chips = screen.getAllByRole('button').filter((b) => b.classList.contains('chip'));
    expect(chips.map((c) => c.textContent).join(' ')).toBe('M T W T F S S');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip selects that day', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(props.onDay).toHaveBeenCalledWith('wed');
  });

  it('moving the slider reports the slot as a number', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Time of day' }), { target: { value: '40' } });
    expect(props.onSlot).toHaveBeenCalledWith(40);
  });

  it('the mode toggle switches mode and the legend word follows the mode', async () => {
    const props = setup();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Docks' }));
    expect(props.onMode).toHaveBeenCalledWith('docks');
  });

  it('legend says Full in docks mode', () => {
    setup({ mode: 'docks' });
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Docks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows Limited data only when days_used < 2', () => {
    setup({ daysUsed: 1.4 });
    expect(screen.getByText('Limited data')).toBeInTheDocument();
  });

  it('hides Limited data at exactly 2 days', () => {
    setup({ daysUsed: 2 });
    expect(screen.queryByText('Limited data')).not.toBeInTheDocument();
  });

  it('shows a loading indicator while loading', () => {
    setup({ status: 'loading', daysUsed: null });
    expect(screen.getByRole('status', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('shows an error with Retry', async () => {
    const props = setup({ status: 'error', daysUsed: null });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load data.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/controls`
Expected: FAIL with "Failed to resolve import './TypicalPanel'".

- [ ] **Step 3: Implement the components**

`frontend/src/controls/DayChips.tsx`:

```tsx
import { dayName } from '../data/slots';
import { DAYS, type Day } from '../data/types';

interface Props {
  day: Day;
  onChange: (day: Day) => void;
}

export function DayChips({ day, onChange }: Props) {
  return (
    <div className="day-chips" role="group" aria-label="Day of week">
      {DAYS.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          aria-label={dayName(d)}
          aria-pressed={d === day}
          onClick={() => onChange(d)}
        >
          {dayName(d)[0]}
        </button>
      ))}
    </div>
  );
}
```

`frontend/src/controls/TimeSlider.tsx`:

```tsx
import { TICK_SLOTS, slotLabel } from '../data/slots';
import { SLOTS_PER_DAY } from '../data/types';

interface Props {
  slot: number;
  onChange: (slot: number) => void;
}

export function TimeSlider({ slot, onChange }: Props) {
  return (
    <div className="time-slider">
      <input
        type="range"
        min={0}
        max={SLOTS_PER_DAY - 1}
        step={1}
        value={slot}
        aria-label="Time of day"
        aria-valuetext={slotLabel(slot)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="ticks" aria-hidden="true">
        {TICK_SLOTS.map((t) => (
          <span key={t} style={{ left: `${(t / (SLOTS_PER_DAY - 1)) * 100}%` }}>
            {slotLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
```

`frontend/src/controls/ModeToggle.tsx`:

```tsx
import type { Mode } from '../data/types';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'bikes', label: 'Bikes' },
  { mode: 'docks', label: 'Docks' },
];

interface Props {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Show availability of">
      {MODES.map((m) => (
        <button key={m.mode} type="button" aria-pressed={m.mode === mode} onClick={() => onChange(m.mode)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
```

`frontend/src/controls/Legend.tsx`:

```tsx
import { BUCKET_COLORS, legendLabels } from '../data/colors';
import type { Mode } from '../data/types';

export function Legend({ mode }: { mode: Mode }) {
  const { low, high } = legendLabels(mode);
  return (
    <div className="legend">
      <span>{low}</span>
      {BUCKET_COLORS.map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
      <span>{high}</span>
    </div>
  );
}
```

`frontend/src/controls/TypicalPanel.tsx`:

```tsx
import { dayName, slotLabel } from '../data/slots';
import type { Day, Mode } from '../data/types';
import type { LoadStatus } from '../data/useTypical';
import { DayChips } from './DayChips';
import { Legend } from './Legend';
import { ModeToggle } from './ModeToggle';
import { TimeSlider } from './TimeSlider';

/** Below this many (recency-weighted) days of history the profile is flagged as thin. */
export const LIMITED_DATA_DAYS = 2;

export interface TypicalPanelProps {
  day: Day;
  slot: number;
  mode: Mode;
  onDay: (day: Day) => void;
  onSlot: (slot: number) => void;
  onMode: (mode: Mode) => void;
  status: LoadStatus;
  daysUsed: number | null;
  onRetry: () => void;
}

export function TypicalPanel(props: TypicalPanelProps) {
  const { day, slot, mode, status, daysUsed } = props;
  return (
    <section className="panel" aria-label="Typical availability">
      <div className="panel-row">
        <h1 className="panel-title">Typical availability</h1>
        <Legend mode={mode} />
        <ModeToggle mode={mode} onChange={props.onMode} />
      </div>
      <div className="panel-row panel-time">
        <DayChips day={day} onChange={props.onDay} />
        <TimeSlider slot={slot} onChange={props.onSlot} />
      </div>
      <div className="panel-row panel-status">
        <span className="when">{`${dayName(day)}, ${slotLabel(slot)}`}</span>
        {status === 'loading' && <span className="skeleton" role="status" aria-label="Loading data" />}
        {status === 'error' && (
          <span className="error" role="alert">
            Couldn't load data.{' '}
            <button type="button" onClick={props.onRetry}>
              Retry
            </button>
          </span>
        )}
        {status === 'ready' && daysUsed !== null && daysUsed < LIMITED_DATA_DAYS && (
          <span className="muted">Limited data</span>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/controls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/controls
git commit -m "feat(frontend): typical-availability control panel"
```

---

### Task 6: Station detail, day chart and bottom sheet

**Files:**
- Create: `frontend/src/station/DayChart.tsx`
- Create: `frontend/src/station/StationDetail.tsx`
- Create: `frontend/src/station/BottomSheet.tsx`
- Test: `frontend/src/station/StationDetail.test.tsx`

**Interfaces:**
- Consumes:
  - `hourly`, `slotLabel` and `TICK_SLOTS` (`slots.ts`)
  - `colorFor` (`colors.ts`)
  - `probabilities`, `counts`, `titleCase` and `formatPercent` (`stations.ts`)
  - `Station`, `Profile`, `Mode`, `Series` and `SLOTS_PER_DAY` (`types.ts`)
  - the fixtures `META`, `makeProfile`, `series` and `stationSeries`
- Produces:
  - `DayChart({ values: Series; slot: number; compact: boolean; onSelect(slot: number): void })`. Each bar is a button named `"<HH:MM>: <percent>"`. The selected bar has `aria-current="true"`.
  - `StationDetail({ station: Station; profile: Profile | null; slot: number; mode: Mode; compact: boolean; onSlot(slot: number): void })`
  - `BottomSheet({ onClose(): void; children: ReactNode })`. It is a `dialog` named `"Station details"` with a `"Close"` button.

- [ ] **Step 1: Write the failing tests**

`frontend/src/station/StationDetail.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { META, makeProfile, series, stationSeries } from '../test/fixtures';
import { BottomSheet } from './BottomSheet';
import { DayChart } from './DayChart';
import { StationDetail } from './StationDetail';

const station = META.stations[0];

function bars() {
  return screen.getAllByRole('button').filter((b) => b.classList.contains('bar-hit'));
}

describe('StationDetail', () => {
  it('bikes mode: title-cased name, typical bikes, chance empty, capacity', () => {
    render(<StationDetail station={station} profile={makeProfile('mon')} slot={36} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Prešernov Trg-Petkovškovo Nabrežje' })).toBeInTheDocument();
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 5 bikes · 5 % chance empty');
    expect(screen.getByText('Capacity 20')).toBeInTheDocument();
  });

  it('docks mode: typical free docks and chance full', () => {
    render(<StationDetail station={station} profile={makeProfile('mon')} slot={36} mode="docks" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 15 free docks · 2 % chance full');
  });

  it('rounds the typical count', () => {
    const profile = makeProfile('mon', { stations: { '1': stationSeries({ bikes: series(6.6) }) } });
    render(<StationDetail station={station} profile={profile} slot={0} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 7 bikes');
  });

  it('station missing from profile shows no data', () => {
    const profile = makeProfile('mon', { stations: {} });
    render(<StationDetail station={station} profile={profile} slot={36} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText('No data for this time')).toBeInTheDocument();
    expect(bars()).toHaveLength(96);
  });
});

describe('DayChart', () => {
  it('desktop: 96 bars, selected slot marked, click selects that slot', async () => {
    const onSelect = vi.fn();
    render(<DayChart values={series(0.2)} slot={36} compact={false} onSelect={onSelect} />);
    expect(bars()).toHaveLength(96);
    expect(screen.getByRole('button', { name: '09:00: 20 %' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: '17:15: 20 %' }));
    expect(onSelect).toHaveBeenCalledWith(69);
  });

  it('compact: 24 hourly bars, click selects the first slot of the hour', async () => {
    const onSelect = vi.fn();
    render(<DayChart values={series(0.2)} slot={37} compact onSelect={onSelect} />);
    expect(bars()).toHaveLength(24);
    expect(screen.getByRole('button', { name: '09:00: 20 %' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: '20:00: 20 %' }));
    expect(onSelect).toHaveBeenCalledWith(80);
  });

  it('compact highlights hour 23 at slot 95', () => {
    render(<DayChart values={series(0.2)} slot={95} compact onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: '23:00: 20 %' })).toHaveAttribute('aria-current', 'true');
  });

  it('null slots are labelled no data', () => {
    render(<DayChart values={series(null)} slot={0} compact={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: '00:00: no data' })).toBeInTheDocument();
  });
});

describe('BottomSheet', () => {
  it('closes from the close button', async () => {
    const onClose = vi.fn();
    render(<BottomSheet onClose={onClose}>content</BottomSheet>);
    const sheet = screen.getByRole('dialog', { name: 'Station details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a downward swipe of the handle, not on a small drag', () => {
    const onClose = vi.fn();
    const { container } = render(<BottomSheet onClose={onClose}>content</BottomSheet>);
    const handle = container.querySelector('.sheet-handle')!;
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle, { clientY: 120 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle, { clientY: 200 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/station`
Expected: FAIL with "Failed to resolve import './BottomSheet'" (or `./DayChart`, or `./StationDetail`).

- [ ] **Step 3: Implement**

`frontend/src/station/DayChart.tsx`:

```tsx
import { colorFor } from '../data/colors';
import { TICK_SLOTS, hourly, slotLabel } from '../data/slots';
import { formatPercent } from '../data/stations';
import { SLOTS_PER_DAY, type Series } from '../data/types';

interface Props {
  values: Series; // 96 slot probabilities
  slot: number;
  compact: boolean; // phones: 24 hourly bars instead of 96
  onSelect: (slot: number) => void;
}

export function DayChart({ values, slot, compact, onSelect }: Props) {
  const slotsPerBar = compact ? 4 : 1;
  const bars = compact ? hourly(values) : values;
  const selected = Math.floor(slot / slotsPerBar);
  return (
    <div className="day-chart">
      <div className="bars">
        {bars.map((p, i) => (
          <button
            key={i}
            type="button"
            className="bar-hit"
            aria-label={`${slotLabel(i * slotsPerBar)}: ${formatPercent(p)}`}
            aria-current={i === selected ? 'true' : undefined}
            onClick={() => onSelect(i * slotsPerBar)}
          >
            <span
              className="bar"
              style={{ height: p === null ? '4%' : `${Math.max(p * 100, 2)}%`, background: colorFor(p) }}
            />
          </button>
        ))}
      </div>
      <div className="ticks" aria-hidden="true">
        {TICK_SLOTS.map((t) => (
          <span key={t} style={{ left: `${(t / SLOTS_PER_DAY) * 100}%` }}>
            {slotLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
```

`frontend/src/station/StationDetail.tsx`:

```tsx
import { counts, formatPercent, probabilities, titleCase } from '../data/stations';
import type { Mode, Profile, Station } from '../data/types';
import { DayChart } from './DayChart';

interface Props {
  station: Station;
  profile: Profile | null;
  slot: number;
  mode: Mode;
  compact: boolean;
  onSlot: (slot: number) => void;
}

export function StationDetail({ station, profile, slot, mode, compact, onSlot }: Props) {
  const probs = probabilities(profile, station.id, mode);
  const count = counts(profile, station.id, mode)[slot];
  const p = probs[slot];
  const bikes = mode === 'bikes';
  return (
    <div className="station-detail">
      <h2>{titleCase(station.name)}</h2>
      {count === null || p === null ? (
        <p>No data for this time</p>
      ) : (
        <p>
          Typically <strong>{Math.round(count)}</strong> {bikes ? 'bikes' : 'free docks'} ·{' '}
          <strong>{formatPercent(p)}</strong> chance {bikes ? 'empty' : 'full'}
        </p>
      )}
      <p className="muted">Capacity {station.capacity}</p>
      <DayChart values={probs} slot={slot} compact={compact} onSelect={onSlot} />
    </div>
  );
}
```

`frontend/src/station/BottomSheet.tsx`:

```tsx
import { useRef, type ReactNode } from 'react';

/** Downward drag on the handle (px) that closes the sheet. */
const SWIPE_CLOSE_PX = 60;

interface Props {
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ onClose, children }: Props) {
  const dragStartY = useRef<number | null>(null);
  return (
    <div className="sheet" role="dialog" aria-label="Station details">
      <div
        className="sheet-handle"
        onPointerDown={(e) => {
          dragStartY.current = e.clientY;
        }}
        onPointerUp={(e) => {
          if (dragStartY.current !== null && e.clientY - dragStartY.current > SWIPE_CLOSE_PX) onClose();
          dragStartY.current = null;
        }}
      />
      <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/station`
Expected: PASS.

If the swipe test fails because `clientY` reads as 0, jsdom is missing `PointerEvent`. Add this polyfill to `src/test/setup.ts`:

```ts
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {}
  Object.assign(window, { PointerEvent: PointerEventPolyfill });
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/station
git commit -m "feat(frontend): station detail with daily chart and mobile bottom sheet"
```

---

### Task 7: Map and app wiring

**Files:**
- Create: `frontend/src/map/StationMap.tsx`
- Create: `frontend/src/useIsDesktop.ts`
- Create: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx` (replace the whole file)
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `useTypical` (Task 4), `TypicalPanel` (Task 5), `StationDetail` and `BottomSheet` (Task 6)
  - `stationFeatureStates` and `stationsGeoJson` (Task 3)
  - `THRESHOLDS`, `BUCKET_COLORS` and `NO_DATA_COLOR` (Task 2)
  - `nowInLjubljana` (Task 2), `MAPBOX_TOKEN` and `DATA_BASE_URL` (Task 1)
- Produces:
  - `StationMapProps`: `{ token: string; meta: Meta | null; profile: Profile | null; slot: number; mode: Mode; selectedId: string | null; onSelect(id: string | null): void; popup: ReactNode; compact: boolean }`
  - `StationMap(props: StationMapProps)`
  - `useIsDesktop(): boolean`
  - `App(props: { baseUrl: string; mapboxToken: string; initialDay: Day; initialSlot: number })`

`StationMap` is not unit-tested, because mapbox-gl needs WebGL. Its only logic is in the pure helpers tested in Task 3, and it gets a manual check in Task 8. `App.test.tsx` replaces it with a stub through `vi.mock`.

- [ ] **Step 1: Write the failing app tests**

`frontend/src/App.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { StationMapProps } from './map/StationMap';
import { BASE_URL, FAIL, allRoutes, makeProfile, mockFetch, type Routes } from './test/fixtures';
import { setViewport } from './test/viewport';

// mapbox-gl needs WebGL; the stub renders one button per station and the desktop popup content.
vi.mock('./map/StationMap', () => ({
  StationMap: ({ meta, onSelect, popup }: StationMapProps) => (
    <div data-testid="map">
      {meta?.stations.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelect(s.id)}>
          {`select station ${s.id}`}
        </button>
      ))}
      {popup}
    </div>
  ),
}));

function renderApp(routes: Routes = allRoutes()) {
  const fetchFn = mockFetch(routes);
  render(<App baseUrl={BASE_URL} mapboxToken="pk.test" initialDay="mon" initialSlot={36} />);
  return fetchFn;
}

const panel = () => screen.getByRole('region', { name: 'Typical availability' });
const waitReady = () => waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

describe('App', () => {
  it('opens at the given day and time and loads data', async () => {
    renderApp();
    expect(screen.getByText('Monday, 09:00')).toBeInTheDocument();
    await waitReady();
    expect(screen.getByRole('button', { name: 'select station 1' })).toBeInTheDocument();
  });

  it('a day chip changes the label', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(screen.getByText('Wednesday, 09:00')).toBeInTheDocument();
  });

  it('shows Limited data for a thin profile only', async () => {
    const routes = allRoutes();
    routes['wed.json'] = makeProfile('wed', { days_used: 1.2 });
    renderApp(routes);
    await waitReady();
    expect(screen.queryByText('Limited data')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(await screen.findByText('Limited data')).toBeInTheDocument();
  });

  it('the slider updates the label', async () => {
    renderApp();
    await waitReady();
    fireEvent.change(screen.getByRole('slider', { name: 'Time of day' }), { target: { value: '37' } });
    expect(screen.getByText('Monday, 09:15')).toBeInTheDocument();
  });

  it('the mode toggle swaps the legend word and the detail sentence', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    expect(screen.getByText(/Typically/)).toHaveTextContent('chance empty');
    expect(within(panel()).getByText('Empty')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Docks' }));
    expect(screen.getByText(/Typically/)).toHaveTextContent('chance full');
    expect(within(panel()).getByText('Full')).toBeInTheDocument();
  });

  it('clicking a chart bar moves the slider', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    await userEvent.click(screen.getByRole('button', { name: /^20:00:/ }));
    expect(screen.getByText('Monday, 20:00')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Time of day' })).toHaveValue('80');
  });

  it('on mobile the station opens in a bottom sheet with an hourly chart', async () => {
    setViewport('mobile');
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    const sheet = screen.getByRole('dialog', { name: 'Station details' });
    expect(within(sheet).getAllByRole('button').filter((b) => b.classList.contains('bar-hit'))).toHaveLength(24);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failed load shows Retry, and Retry loads again', async () => {
    const routes = allRoutes();
    routes['mon.json'] = FAIL;
    renderApp(routes);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load data.");
    routes['mon.json'] = makeProfile('mon');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitReady();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/App.test.tsx`
Expected: FAIL with "Failed to resolve import './App'".

- [ ] **Step 3: Implement `useIsDesktop`**

`frontend/src/useIsDesktop.ts`:

```ts
import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 640px)';

/** Desktop = floating panel + popup + 96-bar chart; otherwise docked panel + bottom sheet + 24 bars. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
```

- [ ] **Step 4: Implement `StationMap`**

`frontend/src/map/StationMap.tsx`:

```tsx
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUCKET_COLORS, NO_DATA_COLOR, THRESHOLDS } from '../data/colors';
import { stationFeatureStates, stationsGeoJson } from '../data/stations';
import type { Meta, Mode, Profile } from '../data/types';

const SOURCE = 'stations';
const LAYER = 'stations';
const LJUBLJANA: [number, number] = [14.5058, 46.0569];
/** Feature-state value for "no data": below every threshold, so `step` maps it to the grey output. */
const NO_DATA_P = -1;

export interface StationMapProps {
  token: string;
  meta: Meta | null;
  profile: Profile | null;
  slot: number;
  mode: Mode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  popup: ReactNode; // desktop popup content; null on mobile
  compact: boolean;
}

export function StationMap({ token, meta, profile, slot, mode, selectedId, onSelect, popup, compact }: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Create the map once per token.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: mapboxgl.Map;
    mapboxgl.accessToken = token;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: LJUBLJANA,
        zoom: 12,
      });
    } catch {
      setFailed(true); // e.g. no WebGL
      return;
    }
    mapRef.current = map;
    map.on('load', () => setLoaded(true));
    map.on('error', (e) => {
      if ((e.error as { status?: number } | undefined)?.status === 401) setFailed(true); // token rejected
    });
    map.on('click', (e) => {
      const hit = map.getLayer(LAYER) ? map.queryRenderedFeatures(e.point, { layers: [LAYER] })[0] : undefined;
      onSelectRef.current(hit ? String(hit.properties?.id) : null);
    });
    return () => {
      mapRef.current = null;
      setLoaded(false);
      map.remove();
    };
  }, [token]);

  // Add the stations source + layer once the style and meta are both ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: stationsGeoJson(meta), promoteId: 'id' });
    map.addLayer({
      id: LAYER,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': [
          'step',
          ['coalesce', ['feature-state', 'p'], NO_DATA_P],
          NO_DATA_COLOR,
          0,
          BUCKET_COLORS[0],
          THRESHOLDS[0],
          BUCKET_COLORS[1],
          THRESHOLDS[1],
          BUCKET_COLORS[2],
          THRESHOLDS[2],
          BUCKET_COLORS[3],
        ],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 11],
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#202124', '#ffffff'],
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
      },
    });
    map.on('mouseenter', LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER, () => {
      map.getCanvas().style.cursor = '';
    });
    const bounds = new mapboxgl.LngLatBounds();
    for (const s of meta.stations) bounds.extend([s.lon, s.lat]);
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  }, [loaded, meta]);

  // Recolour on every day/slot/mode change: feature-state only, the source is never rebuilt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || !map.getSource(SOURCE)) return;
    for (const { id, p } of stationFeatureStates(meta, profile, slot, mode)) {
      map.setFeatureState({ source: SOURCE, id }, { p: p ?? NO_DATA_P });
    }
  }, [loaded, meta, profile, slot, mode]);

  // Selection: outline the station; desktop opens a popup, mobile centres it above the sheet.
  useEffect(() => {
    const map = mapRef.current;
    const station = meta?.stations.find((s) => s.id === selectedId);
    if (!map || !loaded || !station || !map.getSource(SOURCE)) return;
    map.setFeatureState({ source: SOURCE, id: station.id }, { selected: true });
    let popupObj: mapboxgl.Popup | null = null;
    if (compact) {
      map.easeTo({ center: [station.lon, station.lat] });
    } else {
      const node = document.createElement('div');
      popupObj = new mapboxgl.Popup({ closeOnClick: false, maxWidth: '320px', offset: 12 })
        .setLngLat([station.lon, station.lat])
        .setDOMContent(node)
        .addTo(map);
      // Only a user close (×) deselects; our own remove() below clears popupObj first.
      popupObj.on('close', () => {
        if (popupObj) onSelectRef.current(null);
      });
      setPopupNode(node);
    }
    return () => {
      const toRemove = popupObj;
      popupObj = null;
      toRemove?.remove();
      setPopupNode(null);
      if (mapRef.current === map) map.setFeatureState({ source: SOURCE, id: station.id }, { selected: false });
    };
  }, [loaded, meta, selectedId, compact]);

  return (
    <div className="map-wrap">
      <div className="map" ref={containerRef} />
      {failed && (
        <div className="map-failed" role="alert">
          Map failed to load
        </div>
      )}
      {popupNode && popup ? createPortal(popup, popupNode) : null}
    </div>
  );
}
```

- [ ] **Step 5: Implement `App` and replace `main.tsx`**

`frontend/src/App.tsx`:

```tsx
import { useState } from 'react';
import { TypicalPanel } from './controls/TypicalPanel';
import type { Day, Mode } from './data/types';
import { useTypical } from './data/useTypical';
import { StationMap } from './map/StationMap';
import { BottomSheet } from './station/BottomSheet';
import { StationDetail } from './station/StationDetail';
import { useIsDesktop } from './useIsDesktop';

interface Props {
  baseUrl: string;
  mapboxToken: string;
  initialDay: Day;
  initialSlot: number;
}

export function App({ baseUrl, mapboxToken, initialDay, initialSlot }: Props) {
  const [day, setDay] = useState<Day>(initialDay);
  const [slot, setSlot] = useState(initialSlot);
  const [mode, setMode] = useState<Mode>('bikes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { meta, profile, status, retry } = useTypical(baseUrl, day);
  const desktop = useIsDesktop();

  const station = meta?.stations.find((s) => s.id === selectedId) ?? null;
  const detail = station && (
    <StationDetail station={station} profile={profile} slot={slot} mode={mode} compact={!desktop} onSlot={setSlot} />
  );

  return (
    <div className="app">
      <StationMap
        token={mapboxToken}
        meta={meta}
        profile={profile}
        slot={slot}
        mode={mode}
        selectedId={selectedId}
        onSelect={setSelectedId}
        popup={desktop ? detail : null}
        compact={!desktop}
      />
      {!desktop && detail && <BottomSheet onClose={() => setSelectedId(null)}>{detail}</BottomSheet>}
      <TypicalPanel
        day={day}
        slot={slot}
        mode={mode}
        onDay={setDay}
        onSlot={setSlot}
        onMode={setMode}
        status={status}
        daysUsed={profile?.days_used ?? null}
        onRetry={retry}
      />
    </div>
  );
}
```

`frontend/src/main.tsx` (replace the temporary content):

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DATA_BASE_URL, MAPBOX_TOKEN } from './config';
import { nowInLjubljana } from './data/slots';
import './styles.css';

const now = nowInLjubljana();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App baseUrl={DATA_BASE_URL} mapboxToken={MAPBOX_TOKEN} initialDay={now.day} initialSlot={now.slot} />
  </StrictMode>,
);
```

Create an empty `frontend/src/styles.css` now, so the import resolves. Task 8 fills it in.

- [ ] **Step 6: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS and the type check is clean.

If `tsc` rejects one of the paint expressions in `StationMap.tsx`, check the error against the `ExpressionSpecification` type in `node_modules/mapbox-gl/dist/mapbox-gl.d.ts`. Fix the literal itself (for example by adding `as const` to the inner tuple). Do not cast it to `any`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx frontend/src/useIsDesktop.ts frontend/src/map frontend/src/styles.css
git commit -m "feat(frontend): Mapbox station map and app wiring"
```

---

### Task 8: Styles, responsive layout and a manual check with synthetic data

**Files:**
- Modify: `frontend/src/styles.css` (write the whole file)
- Create: `frontend/scripts/fake-data.mjs`

**Interfaces:**
- Consumes: the class names used in Tasks 5–7:
  - `app`, `map-wrap`, `map`, `map-failed`
  - `panel`, `panel-row`, `panel-title`, `panel-time`, `panel-status`, `when`, `skeleton`, `error`, `muted`
  - `legend`, `mode-toggle`, `day-chips`, `chip`, `time-slider`, `ticks`
  - `station-detail`, `day-chart`, `bars`, `bar-hit`, `bar`
  - `sheet`, `sheet-handle`, `sheet-close`
- Produces: `npm run fake-data`, which writes `frontend/public/dev-data/v1/{meta,mon,…,sun}.json`.

- [ ] **Step 1: Write `styles.css`**

`frontend/src/styles.css`:

```css
:root {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #202124;
  --accent: #0b7a75;
  --muted: #5f6368;
  --line: #dadce0;
  --radius: 12px;
  --shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

* {
  box-sizing: border-box;
}

html,
body,
#root,
.app {
  margin: 0;
  height: 100%;
}

.app {
  position: relative;
  overflow: hidden;
}

.map-wrap,
.map {
  position: absolute;
  inset: 0;
}

.map-failed {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #f1f3f4;
  color: var(--muted);
}

/* ---- Typical panel (desktop: floating card, top left) ---- */
.panel {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 2;
  width: 440px;
  display: grid;
  gap: 6px;
  padding: 10px 14px;
  background: #fff;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-title {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.legend {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-style: italic;
  color: var(--muted);
}

.legend span:first-child {
  margin-right: 4px;
}

.legend span:last-child {
  margin-left: 4px;
}

.legend i {
  width: 14px;
  height: 6px;
  border-radius: 2px;
}

.mode-toggle {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 999px;
}

.mode-toggle button {
  padding: 4px 10px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mode-toggle button[aria-pressed='true'] {
  background: var(--accent);
  color: #fff;
}

.day-chips {
  display: flex;
  gap: 2px;
}

.chip {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.chip[aria-pressed='true'] {
  background: var(--accent);
  color: #fff;
}

.time-slider {
  position: relative;
  flex: 1;
  padding-bottom: 16px;
}

.time-slider input {
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}

.ticks {
  position: relative;
  height: 14px;
  font-size: 11px;
  color: var(--muted);
}

.ticks span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

.time-slider .ticks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

.panel-status {
  min-height: 22px;
  font-size: 14px;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

.error {
  color: #a3201d;
  font-size: 13px;
}

.error button {
  padding: 2px 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.skeleton {
  width: 80px;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #eee, #f8f8f8, #eee);
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

/* ---- Station detail + chart ---- */
.mapboxgl-popup-content {
  padding: 12px 14px;
  border-radius: var(--radius);
}

.station-detail h2 {
  margin: 0 24px 6px 0;
  font-size: 15px;
}

.station-detail p {
  margin: 0 0 4px;
  font-size: 14px;
}

.day-chart {
  margin-top: 10px;
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 64px;
}

.bar-hit {
  display: flex;
  flex: 1;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.bar {
  display: block;
  width: 100%;
  border-radius: 1px 1px 0 0;
}

.bar-hit[aria-current='true'] .bar {
  outline: 2px solid #202124;
}

.day-chart .ticks {
  margin-top: 2px;
}

/* ---- Mobile: map on top, then sheet, then docked panel ---- */
.sheet {
  position: relative;
  max-height: 50vh;
  overflow-y: auto;
  padding: 4px 16px 12px;
  background: #fff;
  border-top: 1px solid var(--line);
}

.sheet-handle {
  width: 64px;
  height: 20px;
  margin: 0 auto 4px;
  touch-action: none;
  cursor: grab;
}

.sheet-handle::before {
  content: '';
  display: block;
  width: 40px;
  height: 5px;
  margin: 8px auto 0;
  border-radius: 3px;
  background: var(--line);
}

.sheet-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 44px;
  height: 44px;
  border: 0;
  background: none;
  font-size: 22px;
  cursor: pointer;
}

@media (max-width: 639px) {
  .app {
    display: flex;
    flex-direction: column;
  }

  .map-wrap {
    position: relative;
    flex: 1;
    order: 1;
  }

  .sheet {
    order: 2;
  }

  .panel {
    position: static;
    order: 3;
    width: auto;
    border-radius: 0;
    box-shadow: 0 -1px 0 var(--line);
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
  }

  .panel-row {
    flex-wrap: wrap;
  }

  .panel-time {
    flex-direction: column;
    align-items: stretch;
  }

  .day-chips {
    justify-content: space-between;
  }

  .chip {
    width: 44px;
    height: 44px;
  }

  .time-slider input {
    height: 44px;
  }
}
```

- [ ] **Step 2: Write the synthetic data generator**

`frontend/scripts/fake-data.mjs`:

```js
// Synthetic typical/v1 data for checking the UI before the backend is deployed.
// Writes public/dev-data/v1/ (gitignored; CI never has it, so it is never deployed).
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/dev-data/v1/', import.meta.url);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const STATIONS = 60;
const CENTER = { lat: 46.0569, lon: 14.5058 };

const round = (x, decimals) => Math.round(x * 10 ** decimals) / 10 ** decimals;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const stations = Array.from({ length: STATIONS }, (_, i) => {
  const angle = (i / STATIONS) * 6 * Math.PI; // a spiral around the centre
  const r = 0.004 + (i / STATIONS) * 0.025;
  return {
    id: String(i + 1),
    name: `TESTNA POSTAJA ŠT. ${i + 1}`,
    lat: round(CENTER.lat + r * Math.sin(angle), 5),
    lon: round(CENTER.lon + 1.4 * r * Math.cos(angle), 5),
    capacity: 15 + (i % 4) * 5,
  };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(
  new URL('meta.json', OUT),
  JSON.stringify({ generated_at: new Date().toISOString(), timezone: 'Europe/Ljubljana', slot_minutes: 15, stations }),
);

DAYS.forEach((day, d) => {
  const weekend = d >= 5;
  // Sunday is "thin" so the Limited data note can be checked.
  const profile = { profile: day, days_used: day === 'sun' ? 1.2 : 4.3, stations: {} };
  stations.forEach((s, i) => {
    const series = { bikes: [], docks: [], p_empty: [], p_full: [] };
    for (let slot = 0; slot < 96; slot++) {
      const h = slot / 4;
      // Residential stations (odd) empty in the morning; central ones (even) fill up.
      const commute = weekend ? 0 : Math.exp(-((h - 8) ** 2) / 2) - Math.exp(-((h - 17) ** 2) / 3);
      const direction = i % 2 ? -1 : 1;
      const fill = clamp01(0.5 + 0.5 * direction * commute + 0.1 * Math.sin(i + h / 3));
      const noData = i === STATIONS - 1 && h < 6; // one station without night data → grey
      const bikes = fill * s.capacity;
      series.bikes.push(noData ? null : round(bikes, 1));
      series.docks.push(noData ? null : round(s.capacity - bikes, 1));
      series.p_empty.push(noData ? null : round(clamp01((0.35 - fill) / 0.35), 2));
      series.p_full.push(noData ? null : round(clamp01((fill - 0.65) / 0.35), 2));
    }
    profile.stations[s.id] = series;
  });
  writeFileSync(new URL(`${day}.json`, OUT), JSON.stringify(profile));
});

console.log(`wrote ${DAYS.length + 1} files to ${OUT.pathname}`);
```

- [ ] **Step 3: Generate the data and run the dev server against it**

Run (in `frontend/`):

```bash
npm run fake-data
VITE_DATA_BASE_URL=/bicikelj-log/dev-data/v1/ npm run dev
```

Expected:
- `wrote 8 files to …/frontend/public/dev-data/v1/`
- Vite serves `http://localhost:5173/bicikelj-log/`. The variable set on the command line overrides `.env.local`.

- [ ] **Step 4: Check the desktop view by hand**

Open `http://localhost:5173/bicikelj-log/` in a desktop-width window and verify each item:
- The light basemap is zoomed to fit 60 coloured circles around Ljubljana.
- The panel at the top left shows today's weekday chip selected and the current Ljubljana time.
- Dragging the slider recolours the circles smoothly. On Monday the odd stations go red around 08:00.
- Clicking **Docks** changes the legend word to "Full" and the colours change.
- Clicking **S** (Sunday) shows "Limited data".
- Clicking a circle opens a popup with:
  - a title-cased name ("Testna Postaja Št. 7")
  - the "Typically … · … % chance empty" sentence
  - a 96-bar chart with the current slot outlined
- Clicking a bar moves the slider. Clicking another circle moves the popup. Clicking empty map or × closes it.
- Before 06:00, the last station is grey and shows "No data for this time".

- [ ] **Step 5: Check the mobile view by hand**

Open DevTools device mode at a phone size, e.g. 390 × 844. Verify:
- The panel is docked at the bottom, full width, with 44 px day chips spaced across.
- Tapping a station opens the bottom sheet between the map and the panel. The chart has 24 hourly bars, and the map recentres on the station.
- Dragging the sheet handle down more than about 60 px closes it, and so does ×.
- Nothing overflows horizontally at 360 px width.

- [ ] **Step 6: Confirm the dev data is not tracked**

Run: `git status --short frontend/public`
Expected: no output. `frontend/public/dev-data/` is gitignored (Task 1), so CI builds never contain it. A local `npm run build` copies it into `dist/`, which is harmless because `dist/` is also gitignored.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles.css frontend/scripts/fake-data.mjs
git commit -m "feat(frontend): responsive styles and synthetic dev data"
```

---

### Task 9: CI/CD to GitHub Pages and README

**Files:**
- Create: `.github/workflows/frontend.yml`
- Modify: `README.md` (add a "Frontend" section after "Typical availability (daily build)", and add `frontend/` to "Repository layout")

**Interfaces:**
- Consumes: the npm scripts `typecheck`, `test` and `build` (Task 1), the repo secret `MAPBOX_TOKEN` (already set), and the repo variable `DATA_BASE_URL` (set by the user once the backend is deployed).
- Produces: the site at `https://jakaskerjanc.github.io/bicikelj-log/`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/frontend.yml`:

```yaml
name: frontend
on:
  push:
    branches: [main]
    paths:
      - "frontend/**"
      - ".github/workflows/frontend.yml"
  pull_request:
    paths:
      - "frontend/**"
      - ".github/workflows/frontend.yml"
  workflow_dispatch:

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      # Fork PRs get no secrets/vars; the build only checks that both are set, so placeholders suffice here.
      - run: npm run build
        env:
          VITE_MAPBOX_TOKEN: ${{ secrets.MAPBOX_TOKEN || 'pk.ci-placeholder' }}
          VITE_DATA_BASE_URL: ${{ vars.DATA_BASE_URL || 'https://example.invalid/typical/v1/' }}

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      # No placeholders here: a missing secret/variable must fail the deploy, not ship a blank map.
      - run: npm run build
        env:
          VITE_MAPBOX_TOKEN: ${{ secrets.MAPBOX_TOKEN }}
          VITE_DATA_BASE_URL: ${{ vars.DATA_BASE_URL }}
      - uses: actions/upload-pages-artifact@v5
        with:
          path: frontend/dist
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Validate the workflow syntax**

Run: `npx --yes @action-validator/cli .github/workflows/frontend.yml` (run it from the repo root).
Expected: no errors. If the tool is unavailable, run `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/frontend.yml'))"` instead, which must exit 0.

- [ ] **Step 3: Update the README**

In "Repository layout", add this line after the `backend/` bullet:

```markdown
- `frontend/` — static Mapbox web app (Vite + React + TS) that shows the typical profiles; deployed to GitHub Pages.
```

After the "Typical availability (daily build)" section, add:

````markdown
## Frontend (typical availability map)

`frontend/` is a static site that reads the published `typical/v1/*.json` and shows each
station's chance of being empty (bikes) or full (docks) for any weekday and 15-minute
slot. Live at `https://jakaskerjanc.github.io/bicikelj-log/`. Design:
`docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md`.

```bash
cd frontend
npm ci
cp .env.example .env.local   # then fill in both values
npm run dev                  # http://localhost:5173/bicikelj-log/
npm test && npm run typecheck
```

Before the backend has published anything, use synthetic data:

```bash
npm run fake-data
VITE_DATA_BASE_URL=/bicikelj-log/dev-data/v1/ npm run dev
```

The `frontend` workflow tests every PR and deploys `main` to GitHub Pages. One-time setup:

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. Mapbox: create a public (`pk.`) token with URL restrictions
   `https://jakaskerjanc.github.io/bicikelj-log/` and `http://localhost:5173`.
3. Repo secret `MAPBOX_TOKEN` = that token; repo variable `DATA_BASE_URL` = the
   `publicBaseUrl` deployment output (ends in `/typical/v1/`).
````

- [ ] **Step 4: Run the full local check one last time**

Run (in `frontend/`): `npm ci && npm run typecheck && npm test && npm run build`
Expected: everything passes, and `dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/frontend.yml README.md
git commit -m "ci(frontend): test, build and deploy to GitHub Pages"
```

- [ ] **Step 6: Tell the user about the remaining manual steps**

These cannot be done from code, so report them rather than doing them:
- Set Pages → Source to "GitHub Actions".
- Add URL restrictions to the Mapbox token.
- Set the repo variable `DATA_BASE_URL` once the backend's public account exists. Until it is set, the `deploy` job fails on purpose.
