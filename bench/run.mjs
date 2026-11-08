// Loads the app in headless Chrome once per build, traces each page load, and reports the cost of
// hydration, from `bootstrapApplication()` until the app is stable, and of the work in the next
// 3 frames + 300 ms. Writes results/timings.txt.
// Usage: node bench/run.mjs [--samples=7] [--cpu=1,4] [path-to-chrome]
import {fileURLToPath} from 'node:url';
import {openPage} from '../tools/cdp.mjs';
import {startServers} from '../tools/servers.mjs';
import {teeConsole} from '../tools/tee.mjs';
import {analyzeTrace, GROUP_NAMES, median, TRACE_CATEGORIES} from '../tools/trace-analysis.mjs';
import {VARIANTS} from './patch.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const SAMPLES = Number(opt('samples', 7));
const CPU_RATES = opt('cpu', '1,4').split(',').map(Number);
const chromePath = args.find((a) => !a.startsWith('--'));

const SCENARIOS = [
  {name: 'image grid: 200 NgOptimizedImage, static width/height/sizes', path: '/?bootAfterLoad'},
  {name: 'data table: 300 rows of static markup, 2 images', path: '/table'},
];

teeConsole(fileURLToPath(new URL('../results/timings.txt', import.meta.url)));
const {variants, stop} = await startServers(Object.keys(VARIANTS), 4401);
const page = await openPage('about:blank', chromePath);
console.log(`${page.product}. Median of ${SAMPLES} traced page loads per cell. Times in ms.\n`);

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
  return {result, trace: analyzeTrace(events, ['bootstrap-start', 'app-stable', 'bench-end'])};
}

const fx = (x, d = 1) => +x.toFixed(d);

for (const cpu of CPU_RATES) {
  await page.send('Emulation.setCPUThrottlingRate', {rate: cpu});
  for (const scenario of SCENARIOS) {
    const runs = Object.fromEntries(variants.map((v) => [v.name, []]));
    for (const v of variants) await load(v.port, scenario.path); // Fill the HTTP cache.
    for (let s = 0; s < SAMPLES; s++) {
      // Alternate the order so that drift affects every build equally.
      for (const v of s % 2 ? [...variants].reverse() : variants) runs[v.name].push(await load(v.port, scenario.path));
    }

    // One row: the stock value, then each build's value and its change from stock.
    const row = (f, d = 1) => {
      const values = variants.map((v) => median(runs[v.name].map(f)));
      return Object.fromEntries(variants.map((v, i) => {
        const x = fx(values[i], d);
        if (i === 0 || !values[0]) return [v.name, x];
        const pct = fx(((values[i] - values[0]) / values[0]) * 100, 0);
        return [v.name, `${x} (${pct > 0 ? '+' : ''}${pct}%)`];
      }));
    };
    const hydration = (r) => r.trace.phases[0];
    const after = (r) => r.trace.phases[1];

    console.log(`=== CPU ${cpu}x, ${scenario.name} ===`);
    console.table({
      'hydration: bootstrap to stable': row((r) => r.result.hydrationMs),
      'main thread total': row((r) => hydration(r).total + after(r).total),
      'img load events fired again': row((r) => r.result.imgLoadEvents, 0),
      '(load) handler calls': row((r) => r.result.loadHandlerCalls, 0),
      'elements restyled': row((r) => r.trace.counts['elements restyled'], 0),
      'layouts': row((r) => r.trace.counts['layouts (reflows)'], 0),
      'paints': row((r) => r.trace.counts['paints'], 0),
    });
    console.log('Main-thread self time by kind of work:');
    console.table(Object.fromEntries(GROUP_NAMES.map((g) =>
      [g, row((r) => (hydration(r).byGroup[g] ?? 0) + (after(r).byGroup[g] ?? 0), 2)])));
    console.log('');
  }
}

page.close();
stop();
setTimeout(() => process.exit(0), 300);
