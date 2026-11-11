# Angular hydration writes values that the server already rendered

During hydration, Angular reuses the DOM that the server rendered. It still writes attributes and properties that already have the right value, and the browser reacts to each write. A playing video restarts, an iframe loads its document again, and an image selects its source again.

This repository reproduces the problems in an Angular 22.2.5 server-rendered app and measures two fixes:

| Fix | Issue | Pull request |
|---|---|---|
| Core: don't reload iframes and media | [#52477](https://github.com/angular/angular/issues/52477) | [#71874](https://github.com/angular/angular/pull/71874) |
| `NgOptimizedImage`: don't write unchanged attributes | [#71873](https://github.com/angular/angular/issues/71873) | [#71875](https://github.com/angular/angular/pull/71875) |
| Core: the cost of all the other writes | [#71971](https://github.com/angular/angular/issues/71971) | None yet |

## Hydration restarts playing videos

The `/media` page has autoplaying videos with a timer in the picture. Hydration starts 3 seconds after the page loads. With the published packages, every timer jumps back to 0 when hydration runs:

![With the published Angular packages, each timer shows 0.4 s and each video is marked as restarted](docs/videos-stock.png)

With the fixes, the timers keep counting. The last video is a control. Its `src` differs between the server and the browser, so it must restart.

![With both fixes, the timers show 3.5 s, and only the control video restarted](docs/videos-both-fixes.png)

The result depends on the core fix only. [`results/media.txt`](results/media.txt) has the playback positions:

| Build | `src="…"` | `[src]` | `[attr.src]` | Control |
|---|---|---|---|---|
| `stock` | restarts | restarts | restarts | restarts |
| `directive-fix` | restarts | restarts | restarts | restarts |
| `core-fix` | keeps playing | keeps playing | keeps playing | restarts |
| `both-fixes` | keeps playing | keeps playing | keeps playing | restarts |

## Hydration loads iframes again

The `/media` page also has two iframes. Each document counts how many times it loads. [`results/events.txt`](results/events.txt) has the counts:

| Build | `src="…"` | `[src]` |
|---|---|---|
| `stock` | 2 loads | 2 loads |
| `core-fix` | 1 load | 1 load |

## `NgOptimizedImage` makes the browser select each image again

The `/` page shows 200 `NgOptimizedImage` images with a responsive `srcset` and a `(load)` handler. Two things happen to each image during hydration:

- `NgOptimizedImage` writes `src`, `srcset`, and its other attributes again, with the values that the server rendered. The directive fix removes these writes.
- Angular writes `width`, `height`, and `sizes` from the template.

Each write to one of these attributes makes the browser select the source again. The browser also fires `load` again on images that loaded before hydration. Angular's event replay already delivers the original `load` event, so a `(load)` handler runs twice on those images.

### The `sizes` value changes twice on lazy images

`NgOptimizedImage` prepends `auto` to `sizes` on lazy images, so the server HTML has `sizes="auto, 50vw"` when the template has `sizes="50vw"`. During hydration, Angular writes the template value, and the directive then writes `auto, 50vw` back. Neither fix removes these two writes, because each of them really changes the value. This happens only on a lazy image with a static `sizes` attribute.

The `/bound` page has the same images with `[width]`, `[height]`, and `[sizes]` bindings. Angular doesn't write bound directive inputs to the DOM, so the flip disappears. With the directive fix, `load` no longer fires again on that page, and the handler runs once.

## What the fixes change

Hydration time is the time from `bootstrapApplication()` until `ApplicationRef.whenStable()`, in headless Chrome 156. Each value is the median of 7 page loads. On the image grid, hydration starts after the window `load` event, so the 30 images in the 1280×900 viewport have loaded before hydration. The `/table` page has 300 rows of static classes, ARIA attributes, and SVG icons, and only 2 images.

| Page and CPU | `stock` | `directive-fix` | `core-fix` | `both-fixes` |
|---|---|---|---|---|
| Image grid, no throttling | 38.2 ms | 30.4 ms (−20%) | 37.2 ms (−3%) | 30.0 ms (−21%) |
| Image grid, 4× CPU throttling | 260.6 ms | 206.9 ms (−21%) | 267.0 ms (+2%) | 207.7 ms (−20%) |
| Bound image grid, no throttling | 22.4 ms | 9.5 ms (−58%) | 23.3 ms (+4%) | 10.5 ms (−53%) |
| Bound image grid, 4× CPU throttling | 160.2 ms | 60.7 ms (−62%) | 161.7 ms (+1%) | 60.2 ms (−62%) |
| Table, no throttling | 22.6 ms | 22.0 ms (−3%) | 22.4 ms (−1%) | 22.2 ms (−2%) |
| Table, 4× CPU throttling | 157.5 ms | 163.7 ms (+4%) | 155.4 ms (−1%) | 157.8 ms (0%) |

Differences of a few percent are within the variation between runs. The core fix only stops the writes that reload a resource, so it doesn't change these pages. Hydration still writes every other static attribute, class, and style, and every other binding. [#71971](https://github.com/angular/angular/issues/71971) tracks that cost. On the table page, an experimental patch that also skipped those writes took hydration from 162.0 ms to 61.6 ms at 4× CPU throttling. That patch and its measurements are at commit [`d6b35a8`](https://github.com/jsaguet/ngimg-hydration-repro/tree/d6b35a8).

| Page | Measure | `stock` | `directive-fix` | `core-fix` | `both-fixes` |
|---|---|---|---|---|---|
| Image grid | Attribute writes | 3,637 | 2,033 | 3,637 | 2,033 |
| Image grid | `load` events fired again | 30 | 30 | 30 | 30 |
| Image grid | `(load)` handler calls for 30 loaded images | 60 | 60 | 60 | 60 |
| Bound image grid | Attribute writes | 3,037 | 1,207 | 3,037 | 1,207 |
| Bound image grid | `load` events fired again | 30 | 0 | 30 | 0 |
| Bound image grid | `(load)` handler calls for 30 loaded images | 60 | 30 | 60 | 30 |
| Table | Attribute writes | 12,961 | 12,945 | 12,961 | 12,945 |
| Table | Elements restyled after hydration | 1,247 | 1,245 | 1,247 | 1,245 |

The complete output is in [`results/timings.txt`](results/timings.txt) and [`results/dom-writes.txt`](results/dom-writes.txt). In every build and on every page, the DOM after hydration is the same as in `stock`, apart from two things that the comparison ignores on purpose. Those are the `(load)` counters on the image grid and the marker that `/media` sets on a restarted video.

## What happens to event handlers

A handler can depend on these repeated writes without anyone intending it. [`results/events.txt`](results/events.txt) has handler calls for events that fired before hydration, with event replay on, which is the default, and off:

| Build and event replay | Plain `<img>` `(load)` | Iframe `(load)` | Video `(canplay)` |
|---|---|---|---|
| `stock`, on | 2 | 2 | 1 |
| `core-fix`, on | 2 | 1 | 0 |
| `stock`, off | 1 | 1 | 1 |
| `core-fix`, off | 1 | 0 | 0 |

The iframe values are the same for `src` and `[src]`. The core fix doesn't cover `<img>`, which doesn't load again, so its `(load)` values don't change. Today, a video that was ready before hydration fires `canplay` again because it restarts. With the core fix it doesn't restart, and event replay doesn't cover `canplay`, so the handler doesn't run for that earlier event.

## Run it yourself

You need Google Chrome and a Node.js version that Angular CLI 22.2 supports (`^22.22.3`, `^24.15.0`, or `>=26.0.0`). If Chrome isn't in its default location, set `CHROME_PATH`.

1. Install the packages and build the four variants:

   ```sh
   npm ci
   npm run build:variants
   ```

2. Start a build, and open <http://localhost:4000/media?bootAfterLoad&bootDelay=3000>. Reload the page to watch the timers:

   ```sh
   npm run serve:stock
   ```

   To compare, stop the server and run `npm run serve:both-fixes`.

3. Reproduce the results in `results/`:

   ```sh
   npm run check:videos   # Do the videos restart? (about 30 seconds)
   npm run check:writes   # Which attributes are written, and is the final DOM the same?
   npm run check:events   # How many times do the event handlers run?
   npm run bench          # Hydration time (about 10 minutes)
   ```

## How the builds work

The app in `src/` is the same in every build. `npm run build:variants` patches the published Angular packages in `node_modules`, builds the app, and restores the packages. [`bench/patch.mjs`](bench/patch.mjs) holds the patches, which contain the same changes as the pull requests.

| Build | Patches |
|---|---|
| `stock` | None |
| `directive-fix` | The `NgOptimizedImage` pull request |
| `core-fix` | The core pull request |
| `both-fixes` | Both pull requests |

The measurements come from Chrome only. The video clip is a generated 12-second WebM file (`tools/make-clip.mjs`). The images all come from the app's own server (`/img/*`), so the benchmark doesn't depend on the network.
