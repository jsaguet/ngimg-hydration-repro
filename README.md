# NgOptimizedImage hydration repro

During hydration, `NgOptimizedImage` writes every host attribute (`width`, `height`, `loading`,
`fetchpriority`, `decoding`, `ng-img`, `src`, `srcset`, `sizes`) again, with exactly the values the
server already rendered. Writing an identical `src`, `srcset` or `sizes` is not free for the browser:
each write makes it pick the image again (re-parsing the whole `srcset`), re-request the image from
its cache, invalidate style, and fire `load` again.

This repo measures that cost in a real Angular 22 SSR app, and the effect of skipping writes whose
value is unchanged.

## The app

Two routes, server-rendered and hydrated with the default `provideClientHydration()` (which in
Angular 22 includes incremental hydration and therefore event replay). The app is zoneless (CLI
default).

- `/` **product grid**: 200 `NgOptimizedImage` cards (the first 4 `priority`), each with a
  responsive `srcset` (`sizes` set, default 16 breakpoints, imgix-style URLs served by the app's own
  server), and a `(load)` handler on every image, as used to fade images in or hide skeletons. A
  badge shows how many times it ran.
- `/table` **data table**: 300 rows of static-heavy markup (static classes, ARIA attributes, inline
  styles, inline SVG icons, a `[class.x]` binding next to static classes) and only 2 images.

Each build patches the published bundles in `node_modules` (see [`bench/patch.mjs`](bench/patch.mjs))
and restores them afterwards:

| Build | Change |
|---|---|
| `stock` | `@angular/common` / `@angular/core` 22.2.x as published |
| `fixed` | **The proposed fix**: `NgOptimizedImage#setHostAttribute` skips the write when the element already has that value |
| `compare` | Exploratory core change, **option B**: on DOM nodes reused from the server, write a template's static attribute / class / style only if the DOM value differs. Same final DOM as today |
| `fixed+compare` | `fixed` + `compare` |
| `fixed+skip` | `fixed` + exploratory core change, **option A**: on reused nodes, don't write static attributes / class / style at all (static `@animation` triggers are still registered). Changes behavior, see below |

`npm run bench:inspect` checks that every build ends with the same hydrated DOM as `stock` (it
does, on both pages) and lists which attributes each build writes during hydration.

## Results

Headless Chrome 156, warm HTTP cache, median of 7 traced page loads per cell. Hydration = from
`bootstrapApplication()` until `ApplicationRef.whenStable()`. Main thread = all renderer
main-thread work from bootstrap until 3 frames + 300 ms after stable. Absolute numbers vary between
runs; compare within a row. Full output: [`bench/run-output.txt`](bench/run-output.txt).

### Hydration time

| Page, CPU | stock | fixed | compare (B) | fixed+compare | fixed+skip (A) |
|---|---|---|---|---|---|
| Grid, images loaded first, 1× | 46.6 ms | 37.5 (−20%) | 40.9 (−12%) | 35.4 (−24%) | 13.3 (−71%) |
| Grid, hydrate ASAP, 1× | 44.3 ms | 38.3 (−14%) | 41.0 (−7%) | 35.7 (−19%) | 14.3 (−68%) |
| Grid, images loaded first, 4× | 260 ms | 213 (−18%) | 252 (−3%) | 207 (−20%) | 74 (−71%) |
| Grid, hydrate ASAP, 4× | 272 ms | 235 (−14%) | 266 (−3%) | 219 (−20%) | 77 (−72%) |
| Table, 1× | 29.7 ms | 30.1 (+1%) | 15.3 (−48%) | 15.4 (−48%) | 13.2 (−56%) |
| Table, 4× | 189 ms | 178 (−6%) | 84 (−56%) | 81 (−57%) | 62 (−68%) |

### What the browser does

| | stock | fixed | compare (B) | fixed+compare | fixed+skip (A) |
|---|---|---|---|---|---|
| Grid: attribute writes | 3,637 | 2,033 | 2,432 | 824 | 406 |
| Grid: `load` fired again / `(load)` calls for 30 loaded images | 30 / 60 | 30 / 60 | 30 / 60 | 26 / 56 | 0 / 30 |
| Grid: elements restyled / paints | 230 / 4 | 230 / 4 | 230 / 4 | 222 / 4 | 0 / 2 |
| Table: attribute writes | 12,961 | 12,945 | 365 | 349 | 306 |
| Table: elements restyled / layouts / paints | 1,247 / 1 / 2 | 1,245 / 1 / 2 | 47 / 0 / 2 | 43 / 0 / 0 | 0 / 0 / 0 |

- **Option B roughly halves hydration on static-heavy markup** without changing the final DOM:
  12,961 → 365 writes on the table page. 99% of today's writes there are identical.
- **On image pages, B barely helps on its own.** What remains is the `sizes` conflict (point 2
  below): two real `sizes` changes per lazy image (392 writes), each making Chrome pick the image
  again and fire `load` again. Removing it is the difference between `fixed+compare` (−20%) and
  `fixed+skip` (−71%).
- The remaining `class` writes in B/A come from class *bindings*, not static attributes:
  `classList.remove()` of a class that isn't there still rewrites the attribute.

### What's going on

1. **`NgOptimizedImage` writes all its host attributes again** (9 per image), always with the
   values the server rendered. The `fixed` build skips them.
2. **Core also writes the template's static attributes again on every hydrated element.**
   `elementLikeStartShared()` calls `setupStaticAttributes()` whether the node was just created or
   reused from the server HTML. For these images, that's `width`, `height`, `alt` and `sizes`.
   - Writing `width`, `height` or `sizes` with an identical value still makes Chrome pick the image
     again and fire `load` again. One such write costs about as much as writing `src` + `srcset` +
     `sizes` together (see the DOM benchmark below). That's why `fixed` alone saves less than its
     3,637 → 2,033 drop in writes suggests.
   - For lazy images it's a real change: the server sends `sizes="auto, <sizes>"`, core writes the
     plain template value `<sizes>`, then the directive writes `auto, <sizes>` back.
3. **`load` fires again for every image that already loaded.** Event replay (on by default) already
   replays the pre-hydration `load` to the `(load)` handler, so the handler runs **twice** per
   image and triggers an extra render. With `fixed+skip` it runs exactly once.
4. **No reflow** is caused by the identical writes. The extra cost is script/DOM work, style
   recalculation, repaint and re-fetching from the memory cache.

Images that are still downloading when hydration runs aren't fetched twice: Chrome reuses the
request already in flight (see `dom-benchmark/trace-headless.mjs`, "images still downloading").

## Run it

Requires Node 22+ and Google Chrome (set `CHROME_PATH` if it isn't in the default location).

```sh
npm install
npm run bench:build     # builds dist/<variant> for every build listed above
npm run bench           # traced benchmark (≈15 min): prints the tables, writes bench/results.json
npm run bench:inspect   # one load per build and page: attribute writes, old → new values, final DOM = stock?
```

`npm run bench -- --samples=15 --cpu=1,4,6` changes the sample count and CPU throttling.
The first traced load of each cell is saved in `bench/traces/` and can be opened in
DevTools > Performance > Load profile.

To look at it in a browser: `npm run serve:stock` (or `serve:fixed`) and open
<http://localhost:4000/?bootAfterLoad> or <http://localhost:4000/table>. On the grid, the badges
show `(load) × 2` for images whose handler ran twice.

## DOM benchmark

[`dom-benchmark/`](dom-benchmark) replays the directive's attribute writes on server-rendered
`<img>` markup without Angular. It's useful for isolating the cost of each attribute.

```sh
npm run bench:dom        # write cost: no check vs checking srcset / srcset+src+sizes / all attributes
npm run bench:dom:trace  # full trace breakdown, images loaded vs still downloading
node dom-benchmark/serve.mjs 8080   # interactive page at http://localhost:8080/
```

200 images × 16 breakpoints, Chrome 156:

| Check before writing | Total (ms) | vs no check |
|---|---|---|
| nothing (current) | 14.4 | |
| `srcset` only | 13.2 | −8% |
| `srcset` + `src` + `sizes` | 7.4 | −49% |
| all attributes | 6.9 | −52% |
| (building the strings only, no writes) | 6.5 | |

Writing again just one of `src`, `srcset` or `sizes` costs ~4 ms per 200 images. `width`/`height`
cost ~0.2 ms; `loading`, `fetchpriority`, `decoding` and `ng-img` are negligible.

## Caveats

- Chrome only, headless, local server. Absolute numbers depend on the machine; compare columns.
- The patches target the published 22.2.x bundles; `bench/patch.mjs` fails loudly if the code it
  patches has changed.
- The core changes (`compare`, `skip`) are exploratory and only patch `elementLikeStartShared`
  (template elements), not root component hosts. `skip` changes behavior: server-only classes
  added through `[class]`/`ngClass` bindings would stay, server-side changes to static attributes
  would persist, and `(load)` handlers of images that loaded before hydration only run if event
  replay is on. The table page's DOM matches only because server and client state are the same.
