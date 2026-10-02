# UI framework and charting library for the frontend (issue #6)

Date: 2026-10-02
Status: Research and recommendation. Section 5 (DayChart on visx) was implemented on 2026-10-02.

## TL;DR

- **Charts: keep `DayChart` hand-rolled for now.** It is 40 lines. It meets the spec's
  requirements better than any library does out of the box: every bar is a labelled,
  focusable `<button>` with `aria-current`, the bars are coloured from `colors.ts`, and it
  renders in jsdom without mocks. It adds 0 kB. Recharts, MUI X Charts and Chart.js would
  all make the accessibility and the tests worse.
- **When a real charting need arrives, use visx** (`@visx/scale` + `@visx/shape` +
  `@visx/axis`, about 44 kB gzip together). Examples of such a need: line or area series,
  numeric axes, tooltips, or live-vs-typical comparison. visx is SVG primitives with no
  imposed markup, so the per-bar `role="button"` and `aria-label` contract and the
  current tests survive. If you'd rather have a batteries-included chart and accept
  chart-level instead of bar-level accessibility, use **Recharts 3**.
- **UI component framework: don't adopt one.** The app has four controls. Three of them
  are already native or ARIA-correct elements: a native range input, and `aria-pressed`
  button groups for the day chips and the mode toggle. The fourth is a non-modal bottom
  sheet. Every full kit (MUI, Mantine, Chakra, shadcn + Tailwind v4) would replace
  ~360 lines of plain CSS with a new styling model, for no functional gain. If one
  primitive is ever needed, for example an accessible draggable drawer, add the single
  headless **Base UI** component (`@base-ui/react/drawer`). It is styled with your
  existing CSS.
- Avoid: **Tremor** (npm package peer `react ^18`, last release Jan 2025; copy-paste
  version pins Recharts 2, which no longer gets updates), **vaul** (README says
  "unmaintained"), and canvas libraries (Chart.js, ECharts canvas, uPlot) for this chart,
  because the bars stop being DOM elements.

## 1. What the app actually needs (from the code)

| Thing | Today | Source |
|---|---|---|
| Day chart | 96 bars (24 on phones), height = p, colour = `colorFor(p)`, each a `<button>` with `aria-label="9:00 AM: 20 %"`, selected bar `aria-current="true"`, click → `onSelect(slot)`; `null` drawn as a grey 4 % stub; shared `TimeTicks` axis | `frontend/src/station/DayChart.tsx`, `frontend/src/styles.css` (`.bars`, `.bar-hit`, `.bar`) |
| Time slider | native `<input type="range">` 0…95 with `aria-valuetext` | `frontend/src/controls/TimeSlider.tsx` |
| Day chips / mode toggle | button groups with `aria-pressed` | `frontend/src/controls/DayChips.tsx`, `ModeToggle.tsx` |
| Legend | 4 coloured swatches from `BUCKET_COLORS` | `frontend/src/controls/Legend.tsx` |
| Bottom sheet | `role="dialog"`, close button, pointer swipe-down on a handle; **non-modal**, so the map stays interactive | `frontend/src/station/BottomSheet.tsx` |
| Tests | Vitest 5 + jsdom 30 + Testing Library; DayChart tests query `getByRole('button', { name: '9:00 AM: 20 %' })` and `aria-current`; the only global mock is `matchMedia` | `frontend/src/station/StationDetail.test.tsx`, `frontend/src/test/setup.ts` |
| Stack | React ^19.3, Vite ^8.3, TypeScript ^7.0, mapbox-gl ^3.32; spec says "No state library and no UI kit" | `frontend/package.json`, `docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md` |

**Planned charts:** the specs and plans in `docs/superpowers/` don't mention week views,
heatmaps or comparison charts. The only chart-adjacent item under "Future work" is
"Live current availability … overlaid on or compared with typical availability"
(frontend design spec, "Future work"). So the trigger for a library is still
hypothetical. Two plausible next charts:
(a) a 7×96 week heatmap, which is a CSS grid of the same buttons and needs no library;
(b) live-vs-typical, a line over the bars with a numeric y-axis, which is where a
library starts to pay off.

## 2. Charting libraries

### 2.1 Facts table

Versions, peers and dates come from `npm view <pkg> version peerDependencies time --json`
run on 2026-10-02. Repo activity comes from the GitHub API `pushed_at`.
**Size** is the full package with dependencies inlined and React peers external,
measured from esm.sh `?bundle&target=es2022` builds and then `gzip -9`. It is **not**
tree-shaken, so it is an upper bound. Where bundlephobia answered (it was rate-limiting
most requests), its gzip number is given in brackets for cross-checking.
For scale, `mapbox-gl@3.32.0` measures **518 kB** gzip the same way.

| Library | Latest (date) | React peer | Render | Size gz (full) | License | Repo last push |
|---|---|---|---|---|---|---|
| Recharts | 3.10.1 (2026-07-25) | `^16.8 … \|\| ^19.0.0` | SVG | 158 kB | MIT | 2026-10-02 |
| visx (`shape`+`scale`+`axis`) | 4.0.0 (2026-06-11) | `^18.0.0 \|\| ^19.0.0` | SVG (you write the markup) | 11 + 17 + 16 ≈ 44 kB | MIT | 2026-06-22 |
| Nivo (`@nivo/bar`) | 0.99.0 (2025-05-23) | `^16.14 … \|\| ^19.0` | SVG or canvas | 85 kB | MIT | 2026-07-21 |
| Apache ECharts + echarts-for-react | 6.1.0 (2026-05-19) / 3.0.6 (2026-01-21) | wrapper: `^15.0.0 \|\| >=16.0.0` | canvas or SVG | (bundlephobia: 359 kB full; tree-shakeable via `echarts/core`) | Apache-2.0 / MIT | 2026-09-30 / 2026-01-21 |
| Chart.js + react-chartjs-2 | 4.5.1 (2025-10-13) / 5.3.1 (2025-10-27) | wrapper: `^16.8 … \|\| ^19.0.0` | canvas | 68 kB (bundlephobia 66.8) + 1 kB | MIT | 2026-10-02 |
| Observable Plot | 0.6.17 (2025-02-14) | none (not React) | SVG | 129 kB (bundlephobia 125.0) | ISC | 2026-09-01 |
| uPlot (+ uplot-react) | 1.6.32 (2025-03-14) | wrapper: `>=16.8.6` | canvas | 22 kB (bundlephobia 21.3) | MIT | 2026-09-28 |
| MUI X Charts | 9.14.0 (2026-09-17) | `^17 \|\| ^18 \|\| ^19`, **plus peers `@mui/material`, `@mui/system`, `@emotion/react`, `@emotion/styled`** | SVG | 129 kB (bundlephobia 120.7), excluding Material + Emotion | MIT | 2026-10-02 |
| Victory | 37.3.6 (2025-01-14) | `>=16.6.0` | SVG | 127 kB | MIT | 2025-12-19 |
| Tremor (`@tremor/react`) | 3.18.7 (2025-01-13) | **`react ^18.0.0`**, which conflicts with React 19 | SVG (wraps Recharts `^2.13.3`) | n/a | Apache-2.0 | 2025-01-13 |
| shadcn/ui chart | copy-paste (CLI `shadcn` 4.21.1, 2026-10-01) | n/a (your code); registry app uses React 19.2.3 | SVG (it *is* Recharts 3, `recharts: 3.8.0`) | = Recharts + Tailwind | MIT | 2026-10-02 |

### 2.2 Fit for `DayChart`'s requirements

| Library | Per-bar colour | Click → slot, selected state | Per-bar a11y / keyboard | jsdom testability | Notes |
|---|---|---|---|---|---|
| **Hand-rolled (today)** | `style.background = colorFor(p)` | `onClick`, `aria-current` | Each bar is a real `<button>` with a label; Tab/Enter/Space for free | Works with no mocks (CSS flex layout, no measuring) | 0 kB. Spec requires "a row of buttons (one per bar, so each is tappable and labelled)" |
| **visx** | `fill={colorFor(p)}` on `<Bar>` (`<Bar>` is just a `<rect>` with a class, verified in `lib/shapes/Bar.js`) | your own `onClick` / `<g role="button">` | Whatever you render; you can keep `role="button"`, `tabIndex`, `aria-label`, `aria-current` | Works if you use a fixed `viewBox` instead of `@visx/responsive` (no ResizeObserver) | Primitives only; you still own layout and axes |
| **Recharts 3** | `Cell` still works but is **deprecated, "will be removed in Recharts 4.0"**; use the `shape` prop | `Bar onClick` gives the datum and index; selection outline is up to you via `shape` | `accessibilityLayer` is on by default in v3. It makes the **whole SVG** `role="application"` `tabIndex=0`, and ←/→ move the tooltip while Enter toggles it (`es6/container/RootSurface.js`, `es6/state/keyboardEventsMiddleware.js`). Bars are **not** individually focusable or labelled | `responsive`/`ResponsiveContainer` read `getBoundingClientRect` and a `ResizeObserver` (`es6/chart/RechartsWrapper.js`). jsdom returns 0×0, so you need fixed `width`/`height` in tests or a ResizeObserver/size mock | Large dependency tree (redux toolkit, immer, reselect) |
| **Nivo** | `colors` as a function of the datum | `onClick(datum)` | `isFocusable` (default `false`), `barAriaLabel(datum)`, `barAriaDescribedBy`, `role` (verified in `dist/nivo-bar.mjs` and `types.d.ts`) | `ResponsiveBar` measures its container, so use fixed-size `<Bar>` in tests | Last release May 2025; react-spring animation dependency |
| **MUI X Charts** | `colorMap: { type: 'piecewise', thresholds, colors }` on the axis; this maps directly onto `THRESHOLDS`/`BUCKET_COLORS` (`models/colorMapping.d.ts`) | `onItemClick(event, { dataIndex })` | Has a keyboard-navigation plugin and an "accessibility proxy" element (`internals/plugins/featurePlugins/useChartKeyboardNavigation`, `ChartsAccessibilityProxy`); not per-bar buttons | Measures container (`useChartDimensions` uses ResizeObserver), so needs fixed size or a mock | Pulls in Material UI + Emotion as required peers, which the app has neither of |
| **ECharts** | `itemStyle.color` callback | `chart.on('click')` | `aria.show` generates a chart-level `aria-label` description, plus decal patterns; the handbook doesn't cover focusable data items | Canvas renderer needs a canvas mock in jsdom. SVG renderer is possible, but the wrapper sizes via `size-sensor` | Heavy, imperative options object |
| **Chart.js** | `backgroundColor` array or scriptable function | `onClick` + `getElementsAtEventForMode` | Docs: "The canvas content will not be accessible to screen readers"; you must add `role="img"` + `aria-label` or fallback content | No canvas in jsdom, so you need `vitest-canvas-mock` or similar, and bar clicks can't be tested by role | |
| **Observable Plot** | `fill` channel | no built-in events; you'd add listeners to the generated SVG | `ariaLabel` / `ariaDescription` options at mark level | Renders SVG imperatively in `useEffect` (official React guidance) | Not React-native; great for exploratory charts, awkward for interactive controls |
| **uPlot** | possible via the bars path builder, but awkward | cursor hooks | canvas, none | canvas mock needed | Built for large time series, not 24 to 96 bars |
| **Tremor** | via Recharts | via Recharts | via Recharts | as Recharts | npm package peer-pins React 18. The copy-paste "Tremor Raw" repo's `package.json` pins `react ^18.3.1`, `recharts ^2.15.2`, and Recharts says v2 gets no updates (recharts#7361) |
| **shadcn chart** | via Recharts 3 | via Recharts 3 | via Recharts 3 (`accessibilityLayer`) | as Recharts; docs require a fixed height or `min-h-*` "so `ResponsiveContainer` can measure on first render" | Requires Tailwind v4 + shadcn setup |

**React 19 open issues (GitHub search "React 19", open, 2026-10-02):**
- Recharts #7463 "Maximum update depth exceeded when chart unmounts behind Suspense
  boundary (React 19)", and #6316 (Next 15 + React 19).
- Nivo #2801 (key warning in Choropleth legends; doesn't affect bars).
- echarts-for-react #628 (React 19 `JSX` namespace type error).
- visx: none.
- react-chartjs-2: none relevant.

Neither Recharts issue applies to this app: there's no Suspense, and it isn't Next.js.

## 3. UI component framework

### 3.1 Facts table

Same method as 2.1.

| Library | Latest (date) | React peer | Styling model | Size gz (full) | Has slider / toggle group / drawer | Repo last push |
|---|---|---|---|---|---|---|
| shadcn/ui | copy-paste, CLI 4.21.1 (2026-10-01) | n/a; registry app on React 19.2.3 | **Tailwind v4** (`@tailwindcss/vite` 4.3.3 peer `vite ^5.2 … \|\| ^8`) + `cn()`; built on Radix or Base UI (the registry app depends on both) | only what you copy, plus Radix/Base UI parts | yes / yes / yes, but Drawer = **vaul**, whose README says "This repo is unmaintained" | 2026-10-02 |
| Radix Primitives (`radix-ui`) | 1.6.7 (2026-07-24) | `^16.8 … \|\| ^19.0` | headless, your CSS | 76 kB (bundlephobia 70.1) for everything; slider 8.8, toggle-group 7.5, dialog 12.3 (bundlephobia) | yes / yes / dialog only | 2026-08-08 |
| Base UI (`@base-ui/react`) | 1.8.0 (2026-09-04); 1.0.0 on 2025-12-11 | `^17 \|\| ^18 \|\| ^19` (date-fns peers optional) | headless, your CSS (data attributes) | 159 kB (bundlephobia 143.5) for everything; per-component subpath exports | yes / yes / **yes (`./drawer`)** | 2026-10-02 |
| React Aria Components | 1.21.1 (2026-09-04) | `^16.8 … \|\| ^19.0.0-rc.1` | headless, your CSS (render props, data attributes) | 273 kB (bundlephobia 267.7) for everything | yes (`Slider`) / yes (`ToggleButtonGroup`) / `Modal` (no swipe drawer) | 2026-10-02 |
| Ark UI | 5.39.2 (2026-09-13) | `>=18.0.0` | headless (Zag.js state machines) | 290 kB for everything | yes / yes / yes (`drawer`) | 2026-10-02 |
| Mantine | 9.6.3 (2026-09-26) | **`^19.2.0`** (OK with 19.3) | own CSS + CSS variables (needs its stylesheet and PostCSS preset per docs) | 170 kB (bundlephobia 159.0) | yes / `SegmentedControl` / `Drawer` | 2026-09-26 |
| MUI (Material) | 9.4.0 (2026-08-27) | `^17 \|\| ^18 \|\| ^19` + **Emotion peers** | CSS-in-JS (Emotion), Material look | 162 kB + Emotion | yes / yes / `SwipeableDrawer` | 2026-10-02 |
| Chakra UI | 3.37.0 (2026-08-28) | `>=18` + **Emotion peer** | CSS-in-JS / style props (built on Ark) | 311 kB | yes / yes / yes | 2026-09-24 |

### 3.2 Assessment

- **The app already has the controls.** Native `<input type="range">` gives keyboard,
  touch and screen-reader support for free (`aria-valuetext` is set). The chips and the
  mode toggle are `aria-pressed` button groups. A library `ToggleGroup` would add roving
  tabindex, and that is the only gain.
- **The bottom sheet is deliberately non-modal**, because the map stays tappable. A
  `Dialog`/`Drawer` primitive is built around modal focus trapping. You'd have to opt out
  (Base UI and Radix both support non-modal mode per their docs; not tested here), and
  the hand-rolled swipe-to-close already works and is tested.
- **The styling model is the real cost.** Moving to shadcn means installing Tailwind v4,
  adding `@` path aliases and `cn()`, and rewriting `styles.css` into utilities. MUI and
  Chakra bring Emotion runtime CSS-in-JS. Mantine brings its own global stylesheet and
  PostCSS. Each is a rewrite of every component's markup for a 4-control app. Headless
  libraries (Base UI, Radix, React Aria) are the only ones that coexist with the current
  CSS, and you can adopt them one component at a time.
- **Bundle:** mapbox-gl already dominates the bundle (518 kB gz). A single headless
  primitive (~10 to 15 kB) is noise. A full kit is not.

## 4. Recommendation

1. **Close issue #6 as "evaluated, no framework adopted"**, or keep it open with the
   triggers below. Keep `DayChart` and the controls hand-rolled. Update the spec line
   "No state library and no UI kit" to point at this note.
2. **Chart trigger:** adopt **visx** (`@visx/scale`, `@visx/shape`, `@visx/axis`, and
   `@visx/tooltip` only if needed) the first time a chart needs any of:
   - a continuous numeric axis or gridlines
   - lines or areas (for example live vs typical)
   - multiple series
   - tooltips

   A week heatmap alone does **not** count: it is a 7×N CSS grid of the same buttons.
3. **Recharts 3** is the fallback if you'd rather get a declarative, batteries-included
   chart (axes, tooltip, legend) and accept chart-level keyboard navigation instead of
   per-bar buttons. Use `shape` rather than the deprecated `Cell`.
4. **UI primitives trigger:** if you need a real drawer with snap points or focus
   management, or a popover or tooltip, add the individual **Base UI** component.
   Reasons: it is headless and works with plain CSS; it is MUI-maintained, stable since
   2025-12-11 and released monthly; it has a `drawer` (unlike Radix); and it avoids vaul.
   Don't add Tailwind or shadcn for this.

## 5. Migration sketch: `DayChart` on visx (for when the trigger is hit)

This keeps the public props and the test contract identical.

```tsx
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';

const W = 960, H = 64; // internal coordinates; the SVG scales with CSS width

export function DayChart({ values, slot, compact, onSelect }: Props) {
  const slotsPerBar = compact ? 4 : 1;
  const bars = compact ? hourly(values) : values;
  const selected = Math.floor(slot / slotsPerBar);
  const x = scaleBand({ domain: bars.map((_, i) => i), range: [0, W], padding: 0.1 });
  const y = scaleLinear({ domain: [0, 1], range: [H, 0] });
  return (
    <div className="day-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bars">
        {bars.map((p, i) => {
          const h = p === null ? H * 0.04 : Math.max(H - y(p), H * 0.02);
          return (
            <g key={i} role="button" tabIndex={0}
               aria-label={`${slotLabel(i * slotsPerBar)}: ${formatPercent(p)}`}
               aria-current={i === selected ? 'true' : undefined}
               onClick={() => onSelect(i * slotsPerBar)}
               onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i * slotsPerBar); } }}>
              <rect x={x(i)} y={0} width={x.bandwidth()} height={H} fill="transparent" />{/* full-height hit area */}
              <Bar x={x(i)} y={H - h} width={x.bandwidth()} height={h} fill={colorFor(p)} className="bar" />
            </g>
          );
        })}
      </svg>
      <TimeTicks span={SLOTS_PER_DAY} />{/* or @visx/axis AxisBottom once ticks need to live inside the SVG */}
    </div>
  );
}
```

**Test implications (visx):**
- `getByRole('button', { name: '9:00 AM: 20 %' })`, `toHaveAttribute('aria-current', 'true')`
  and `userEvent.click` all keep working, because jsdom exposes `role`/`aria-label` on
  SVG `<g>`.
- The only change is the `bars()` helper in `StationDetail.test.tsx`, which filters on
  `.bar-hit`. Keep that class on the `<g>`.
- No ResizeObserver or canvas mocks are needed, because the fixed `viewBox` means
  nothing is measured.
- Add one keyboard test (Enter selects). Native `<button>` gave Enter and Space for free;
  `role="button"` on SVG does not.
- CSS: `.bar-hit[aria-current='true'] .bar { outline }` doesn't work on SVG. Use
  `stroke`/`stroke-width` instead.

**Test implications (Recharts, if chosen instead):**
- The bars are `<path class="recharts-rectangle">` with no role or name, so every
  `getByRole('button', { name })` assertion must be rewritten. The options are to query
  `.recharts-bar-rectangle` by index, or to inject `role`/`aria-label` through a custom
  `shape` component, at which point you've re-implemented the hand-rolled bars.
- Tests must pass a fixed `width`/`height`, or mock `ResizeObserver` and
  `getBoundingClientRect`. Otherwise jsdom's 0×0 layout renders no bars.
- Keyboard behaviour changes from "Tab to a bar, Enter" to "focus the chart, ←/→ move
  the tooltip". Selecting a slot would need `onClick` plus your own key handling.

## 6. Not verified / caveats

- **Nothing was installed or built** (by instruction). React 19.3 / Vite 8 / TypeScript 7
  compatibility is inferred from `peerDependencies` and the absence of open issues, not
  from a build. `@vitejs/plugin-react` and `@tailwindcss/vite` are the only packages
  checked that declare a Vite peer, and both allow `^8`. TypeScript 7 type-checking of
  each library's `.d.ts` was not tested.
- **Sizes are full-package upper bounds**, not tree-shaken app costs. Bundlephobia
  rate-limited (HTTP 429) most queries. esm.sh numbers agree with the bundlephobia
  numbers that did return (Chart.js 68 vs 66.8, uPlot 22 vs 21.3, MUI X 129 vs 120.7,
  Mantine 170 vs 159). The ECharts number is bundlephobia's full build only; the
  `echarts/core` tree-shaken size was not measured.
- Non-modal Drawer/Dialog modes in Base UI and Radix were not tested.
- MUI X Charts' keyboard navigation was confirmed to exist in source but was not
  exercised. Whether it can be made to select a slot was not checked.
- The `@tremor/react` peer conflict is from npm metadata; `npm install` would hit
  ERESOLVE without `--legacy-peer-deps` (standard npm 7+ behaviour, not run here).

## Sources

Repository (read 2026-10-02):
- `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/station/DayChart.tsx`, `frontend/src/station/BottomSheet.tsx`, `frontend/src/controls/*.tsx`, `frontend/src/data/colors.ts`, `frontend/src/styles.css`, `frontend/src/station/StationDetail.test.tsx`, `frontend/src/test/setup.ts`
- `docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md` ("Stack and hosting", "`DayChart`", "Testing", "Future work")

npm registry (`npm view <pkg> version license peerDependencies dependencies time --json`):
- https://www.npmjs.com/package/recharts, https://www.npmjs.com/package/@visx/shape, https://www.npmjs.com/package/@visx/xychart, https://www.npmjs.com/package/@nivo/bar, https://www.npmjs.com/package/echarts, https://www.npmjs.com/package/echarts-for-react, https://www.npmjs.com/package/chart.js, https://www.npmjs.com/package/react-chartjs-2, https://www.npmjs.com/package/@observablehq/plot, https://www.npmjs.com/package/uplot, https://www.npmjs.com/package/uplot-react, https://www.npmjs.com/package/@mui/x-charts, https://www.npmjs.com/package/@tremor/react, https://www.npmjs.com/package/victory
- https://www.npmjs.com/package/radix-ui, https://www.npmjs.com/package/@base-ui/react, https://www.npmjs.com/package/react-aria-components, https://www.npmjs.com/package/@ark-ui/react, https://www.npmjs.com/package/@mantine/core, https://www.npmjs.com/package/@mantine/charts, https://www.npmjs.com/package/@mui/material, https://www.npmjs.com/package/@chakra-ui/react, https://www.npmjs.com/package/tailwindcss, https://www.npmjs.com/package/@tailwindcss/vite, https://www.npmjs.com/package/vaul, https://www.npmjs.com/package/shadcn

Package source (from `npm pack` tarballs, read not installed):
- recharts 3.10.1: `es6/container/RootSurface.js` (role `application`, `tabIndex 0`), `es6/state/keyboardEventsMiddleware.js` (ArrowLeft/ArrowRight/Enter), `es6/chart/RechartsWrapper.js` (ResizeObserver + getBoundingClientRect)
- @mui/x-charts 9.14.0: `models/colorMapping.d.ts` (`PiecewiseColorConfig`), `BarChart/BarPlot.d.ts` (`onItemClick`), `internals/plugins/featurePlugins/useChartKeyboardNavigation/`, `internals/plugins/corePlugins/useChartDimensions/useChartDimensions.mjs`
- @nivo/bar 0.99.0: `dist/nivo-bar.mjs`, `dist/types/types.d.ts` (`isFocusable` default false, `barAriaLabel`)
- @visx/shape 4.0.0: `lib/shapes/Bar.js` (plain `<rect>`)
- react-aria-components 1.21.1 (`dist/exports/Slider`, `ToggleButtonGroup`, `Modal`); @ark-ui/react 5.39.2 (`components/slider`, `toggle-group`, `drawer`); @base-ui/react 1.8.0 `exports` (`./drawer`, `./slider`, `./toggle-group`)

Sizes:
- esm.sh bundles, e.g. https://esm.sh/recharts@3.10.1?bundle&target=es2022 (same pattern for every package in the tables), gzip -9 measured locally
- https://bundlephobia.com/api/size?package=chart.js@4.5.1 (also echarts@6.1.0, uplot@1.6.32, @observablehq/plot@0.6.17, @mui/x-charts@9.14.0, radix-ui@1.6.7, @radix-ui/react-slider@1.4.7, @radix-ui/react-toggle-group@1.1.19, @radix-ui/react-dialog@1.1.23, @base-ui/react@1.8.0, react-aria-components@1.21.1, @mantine/core@9.6.3, vaul@1.1.2)

Docs:
- Recharts 3 migration guide: https://github.com/recharts/recharts/wiki/3.0-migration-guide (accessibilityLayer default true)
- Recharts `Cell` deprecation: https://recharts.github.io/en-US/api/Cell/
- Recharts BarChart `responsive`: https://recharts.github.io/en-US/api/BarChart/
- shadcn chart (Recharts v3, "We do not wrap Recharts", height requirement): https://ui.shadcn.com/docs/components/chart
- Chart.js accessibility: https://www.chartjs.org/docs/latest/general/accessibility.html
- Chart.js tree-shaking: https://www.chartjs.org/docs/latest/getting-started/integration.html
- ECharts ARIA: https://echarts.apache.org/handbook/en/best-practices/aria/
- ECharts minimal imports: https://echarts.apache.org/handbook/en/basics/import/
- Observable Plot in React: https://github.com/observablehq/plot/blob/main/docs/getting-started.md#plot-in-react
- Tailwind v4 + Vite: https://tailwindcss.com/docs/installation/using-vite

GitHub (API `repos/<owner>/<repo>` for `pushed_at`, stars, license; issue search "React 19" open):
- https://github.com/recharts/recharts (issues #7463, #6316, #7361), https://github.com/airbnb/visx (release v4.0.0, 2026-06-11), https://github.com/plouc/nivo (issue #2801), https://github.com/apache/echarts, https://github.com/hustcc/echarts-for-react (issue #628), https://github.com/chartjs/Chart.js, https://github.com/reactchartjs/react-chartjs-2, https://github.com/observablehq/plot, https://github.com/leeoniya/uPlot, https://github.com/mui/mui-x, https://github.com/FormidableLabs/victory
- https://github.com/tremorlabs/tremor-npm, https://github.com/tremorlabs/tremor (`package.json`: `react ^18.3.1`, `recharts ^2.15.2`)
- https://github.com/shadcn-ui/ui (`apps/v4/package.json`: `recharts 3.8.0`, `react 19.2.3`, `radix-ui`, `@base-ui/react`, `vaul`; `apps/v4/registry/new-york-v4/ui/drawer.tsx` imports `vaul`)
- https://github.com/emilkowalski/vaul (README: "This repo is unmaintained")
- https://github.com/radix-ui/primitives, https://github.com/mui/base-ui, https://github.com/adobe/react-spectrum, https://github.com/chakra-ui/ark, https://github.com/mantinedev/mantine, https://github.com/mui/material-ui, https://github.com/chakra-ui/chakra-ui
