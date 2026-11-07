// Loads the SSR app built by bench/build-variants.mjs in headless Chrome, once per variant (see
// VARIANTS in bench/patch.mjs), traces each page load and reports what hydration costs from
// `bootstrapApplication()` until the app is stable, plus the follow-up work in the next 3 frames +
// 300 ms. Attribute-write counts come from a separate untimed load (the MutationObserver costs time).
// Usage: node bench/run.mjs [--samples=7] [--cpu=1,4] [--variants=a,b] [path-to-chrome]
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openPage} from '../tools/cdp.mjs';
import {analyzeTrace, GROUP_NAMES, median, TRACE_CATEGORIES} from '../tools/trace-analysis.mjs';
import {VARIANTS as ALL_VARIANTS} from './patch.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const SAMPLES = Number(opt('samples', 7));
const CPU_RATES = opt('cpu', '1,4').split(',').map(Number);
const chromePath = args.find((a) => !a.startsWith('--'));

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const VARIANTS = opt('variants', Object.keys(ALL_VARIANTS).join(',')).split(',')
  .map((name, i) => ({name, port: 4401 + i}));
const ALL_SCENARIOS = [
  {name: 'product grid (200 images), hydrate after images loaded', path: '/?bootAfterLoad'},
  {name: 'product grid (200 images), hydrate as soon as JS runs', path: '/'},
  {name: 'product grid, width/height/sizes bound, hydrate after images loaded', path: '/bound?bootAfterLoad'},
  {name: 'data table (300 rows, 2 images)', path: '/table'},
];
// --paths=/,/table runs only the scenarios with those paths.
const PATHS = opt('paths', '');
const SCENARIOS = PATHS ? ALL_SCENARIOS.filter((s) => PATHS.split(',').includes(s.path)) : ALL_SCENARIOS;

// --- Servers -----------------------------------------------------------------------------------
const servers = VARIANTS.map(({name, port}) =>
  spawn(process.execPath, [join(root, 'dist', name, 'server', 'server.mjs')], {
    env: {...process.env, PORT: String(port)},
    stdio: 'ignore',
  }));
const stopServers = () => servers.forEach((s) => s.kill());
process.on('exit', stopServers);
for (const {name, port} of VARIANTS) {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/img/ping`)).ok) break;
    } catch {}
    if (i > 100) throw new Error(`dist/${name} server did not start (did you run bench/build-variants.mjs?)`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- Measurement -------------------------------------------------------------------------------
const page = await openPage('about:blank', chromePath);
console.log(`${page.product}, median of ${SAMPLES} traced page loads per cell.\n` +
  `Variants: ${VARIANTS.map((v) => `${v.name} = ${JSON.stringify(ALL_VARIANTS[v.name])}`).join(', ')}\n`);

async function navigate(url) {
  const loaded = new Promise((r) => { const off = page.on('Page.loadEventFired', () => { off(); r(); }); });
  await page.send('Page.navigate', {url});
  await loaded;
  return page.evaluate('window.__bench.done');
}

async function load(port, path) {
  const events = [];
  const offData = page.on('Tracing.dataCollected', (p) => events.push(...p.value));
  const complete = new Promise((r) => { const off = page.on('Tracing.tracingComplete', () => { off(); r(); }); });
  await page.send('Tracing.start', {transferMode: 'ReportEvents', traceConfig: {includedCategories: TRACE_CATEGORIES}});
  const result = await navigate(`http://localhost:${port}${path}`);
  await page.send('Tracing.end');
  await complete;
  offData();
  const trace = analyzeTrace(events, ['bootstrap-start', 'app-stable', 'bench-end']);
  return {result, trace, events};
}

// Untimed load with the attribute MutationObserver enabled (`inspect`), to count attribute writes.
const inspectLoad = (port, path) =>
  navigate(`http://localhost:${port}${path}${path.includes('?') ? '&' : '?'}inspect`);

const tracesDir = join(root, 'bench', 'traces');
mkdirSync(tracesDir, {recursive: true});
const slug = (s) => s.replace(/\W+/g, '-').replace(/-$/, '');
const fx = (x, d = 1) => +x.toFixed(d);
const report = {chrome: page.product, samples: SAMPLES, variants: ALL_VARIANTS, cells: []};

for (const cpu of CPU_RATES) {
  await page.send('Emulation.setCPUThrottlingRate', {rate: cpu});
  for (const scenario of SCENARIOS) {
    const runs = Object.fromEntries(VARIANTS.map((v) => [v.name, []]));
    for (const v of VARIANTS) await load(v.port, scenario.path); // warm the HTTP caches
    const inspected = {};
    for (const v of VARIANTS) inspected[v.name] = await inspectLoad(v.port, scenario.path);
    for (let s = 0; s < SAMPLES; s++) {
      for (const v of s % 2 ? [...VARIANTS].reverse() : VARIANTS) {
        const run = await load(v.port, scenario.path);
        runs[v.name].push(run);
        if (s === 0) {
          writeFileSync(join(tracesDir, `cpu${cpu}x--${slug(scenario.name)}--${slug(v.name)}.json`),
            JSON.stringify({traceEvents: run.events}));
        }
        delete run.events;
      }
    }

    // One row: the stock value, then each variant's value and its change vs stock.
    const cells = (values, d) => {
      const base = values[0];
      return Object.fromEntries(VARIANTS.map((v, i) => {
        const x = fx(values[i], d);
        if (i === 0 || !base) return [v.name, x];
        const pct = fx(((values[i] - base) / base) * 100, 0);
        return [v.name, `${x} (${pct > 0 ? '+' : ''}${pct}%)`];
      }));
    };
    const row = (f, d = 1) => cells(VARIANTS.map((v) => median(runs[v.name].map(f))), d);
    const hydration = (r) => r.trace.phases[0];
    const after = (r) => r.trace.phases[1];

    const summary = {
      'hydration: bootstrap → stable (ms)': row((r) => r.result.hydrationMs),
      'main thread after stable (ms)': row((r) => after(r).total),
      'main thread total (ms)': row((r) => hydration(r).total + after(r).total),
      'attribute writes, all elements (untimed load)': cells(VARIANTS.map((v) => inspected[v.name].attrWrites), 0),
      'img load events': row((r) => r.result.imgLoadEvents, 0),
      '(load) handler calls': row((r) => r.result.loadHandlerCalls, 0),
      'renders after stable': row((r) => r.result.rendersAfterStable, 0),
      ...Object.fromEntries(['elements restyled', 'layouts (reflows)', 'paints']
        .map((k) => [k, row((r) => r.trace.counts[k], 0)])),
    };
    const byGroup = Object.fromEntries(GROUP_NAMES.map((g) =>
      [g, row((r) => (hydration(r).byGroup[g] ?? 0) + (after(r).byGroup[g] ?? 0), 2)]));

    console.log(`=== CPU ${cpu}x, ${scenario.name} ===`);
    console.table(summary);
    console.log('Main-thread self time by kind of work, bootstrap → end of window (ms):');
    console.table(byGroup);
    console.log();
    report.cells.push({cpu, scenario: scenario.name, summary, byGroup});
  }
}

writeFileSync(join(root, 'bench', 'results.json'), JSON.stringify(report, null, 2));
page.close();
stopServers();
setTimeout(() => process.exit(0), 300);
