// Records a Chrome performance trace around each hydration replay and breaks down ALL renderer
// main-thread work (script/DOM, style, layout, paint, image fetch, decode, event dispatch), both
// during the synchronous write loop and in the 3 frames + 300 ms after it (async follow-ups).
// Two scenarios: images already loaded at hydration time, and images still downloading.
// Usage: node dom-benchmark/trace-headless.mjs [path-to-chrome]
// Writes dom-benchmark/traces/<scenario>--<variant>.json (DevTools > Performance > Load profile).
import {mkdirSync, writeFileSync} from 'node:fs';
import {openPage} from '../tools/cdp.mjs';
import {analyzeTrace, GROUP_NAMES, median, TRACE_CATEGORIES} from '../tools/trace-analysis.mjs';
import {serve} from './serve.mjs';

const CFG = {images: 200, breakpoints: 16};
const VARIANTS = ['current (no check)', 'fix all attributes'];
const SCENARIOS = [
  {name: 'images already loaded', slow: false},
  {name: 'images still downloading', slow: true},
];
const SAMPLES = 7;

const server = await serve();
const page = await openPage(`http://127.0.0.1:${server.address().port}/`, process.argv[2]);
await page.send('Network.enable');
console.log(`${page.product}\n${CFG.images} images x ${CFG.breakpoints} breakpoints ` +
  `(first 4 priority), median of ${SAMPLES} traced samples per variant\n`);

let nonce = 0;
async function traceOnce(variant, scenario) {
  const id = `s${++nonce}`;
  await page.evaluate(`prepareSample(${JSON.stringify({...CFG, slow: scenario.slow, nonce: id})})`);

  const net = {requests: 0, canceled: 0};
  const reqIds = new Set();
  const offReq = page.on('Network.requestWillBeSent', (p) => {
    if (p.type === 'Image') { net.requests++; reqIds.add(p.requestId); }
  });
  const offFail = page.on('Network.loadingFailed', (p) => {
    if (reqIds.has(p.requestId) && p.canceled) net.canceled++;
  });

  const events = [];
  const offData = page.on('Tracing.dataCollected', (p) => events.push(...p.value));
  const complete = new Promise((r) => { const off = page.on('Tracing.tracingComplete', () => { off(); r(); }); });
  await page.send('Tracing.start', {transferMode: 'ReportEvents', traceConfig: {includedCategories: TRACE_CATEGORIES}});
  await page.evaluate('new Promise((r) => setTimeout(r, 200))');
  const result = await page.evaluate(`hydrateSample(${JSON.stringify(variant)})`);
  await page.send('Tracing.end');
  await complete;
  offData(); offReq(); offFail();
  return {result, events, net};
}

mkdirSync(new URL('./traces/', import.meta.url), {recursive: true});
const slug = (s) => s.replace(/\W+/g, '-').replace(/-$/, '');
const [A, B] = VARIANTS;
const fx = (x, d = 2) => +x.toFixed(d);

for (const scenario of SCENARIOS) {
  const runs = Object.fromEntries(VARIANTS.map((v) => [v, []]));
  await traceOnce(A, scenario); // warm-up
  for (let s = 0; s < SAMPLES; s++) {
    for (const v of s % 2 ? [...VARIANTS].reverse() : VARIANTS) {
      const {result, events, net} = await traceOnce(v, scenario);
      const trace = analyzeTrace(events, ['hydrate-start', 'hydrate-writes-done', 'hydrate-end']);
      runs[v].push({page: result, during: trace.phases[0], after: trace.phases[1], counts: trace.counts, net});
      if (s === 0) {
        writeFileSync(new URL(`./traces/${slug(scenario.name)}--${slug(v)}.json`, import.meta.url),
          JSON.stringify({traceEvents: events}));
      }
    }
  }
  const med = (v, f) => median(runs[v].map(f));

  console.log(`=== Scenario: ${scenario.name} ===`);
  console.log('Renderer main-thread self time, ms:');
  const timeRow = (f) => {
    const da = med(A, (r) => f(r.during)), db = med(B, (r) => f(r.during));
    const aa = med(A, (r) => f(r.after)), ab = med(B, (r) => f(r.after));
    return {
      'during writes: current': fx(da), 'during writes: fixed': fx(db),
      'after writes: current': fx(aa), 'after writes: fixed': fx(ab),
      'saved': fx(da + aa - db - ab),
    };
  };
  console.table(Object.fromEntries([
    ...GROUP_NAMES.map((g) => [g, timeRow((p) => p.byGroup[g] ?? 0)]),
    ['TOTAL', timeRow((p) => p.total)],
  ]));

  console.log('What the browser did (whole window):');
  const countRow = (f) => ({[A]: med(A, f), [B]: med(B, f)});
  console.table(Object.fromEntries([
    ...Object.keys(runs[A][0].counts).map((k) => [k, countRow((r) => r.counts[k])]),
    ['image requests started', countRow((r) => r.net.requests)],
    ['image requests canceled', countRow((r) => r.net.canceled)],
    ['img load events (page)', countRow((r) => r.page.loads)],
    ['LCP entries (page)', countRow((r) => r.page.lcp)],
    ['currentSrc changed (page)', countRow((r) => r.page.currentSrcChanged)],
    ['attribute mutations (page)', countRow((r) => r.page.mutations)],
  ]));

  console.log('Top trace events by main-thread self time saved, ms:');
  const names = new Set(VARIANTS.flatMap((v) => runs[v].flatMap((r) =>
    [...Object.keys(r.during.byName), ...Object.keys(r.after.byName)])));
  const tot = (v, n) => med(v, (r) => (r.during.byName[n] ?? 0) + (r.after.byName[n] ?? 0));
  console.table(Object.fromEntries([...names]
    .map((n) => [n, {current: fx(tot(A, n)), fixed: fx(tot(B, n)), saved: fx(tot(A, n) - tot(B, n))}])
    .sort(([, a], [, b]) => Math.abs(b.saved) - Math.abs(a.saved)).slice(0, 10)));
  console.log();
}

page.close();
server.close();
setTimeout(() => process.exit(0), 600); // slow image responses may still be pending
