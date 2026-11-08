// Loads each page once per build (untimed, attribute MutationObserver on) and prints which DOM
// writes happened during hydration, and whether the hydrated DOM is identical to the stock build's.
// Usage: node bench/inspect.mjs [path-to-chrome]
import {fileURLToPath} from 'node:url';
import {openPage} from '../tools/cdp.mjs';
import {startServers} from '../tools/servers.mjs';
import {teeConsole} from '../tools/tee.mjs';
import {VARIANTS} from './patch.mjs';

const chromePath = process.argv[2];
teeConsole(fileURLToPath(new URL('../results/dom-writes.txt', import.meta.url)));
const PAGES = [
  {name: 'image grid: 200 NgOptimizedImage, static width/height/sizes', path: '/?bootAfterLoad&inspect'},
  {name: 'bound image grid: same grid, [width]/[height]/[sizes] bindings', path: '/bound?bootAfterLoad&inspect'},
  {name: 'data table: 300 rows of static markup, 2 images', path: '/table?bootAfterLoad&inspect'},
  {name: 'media: videos, and values that differ between server and browser', path: '/media?bootAfterLoad&inspect'},
];

const {variants, stop} = await startServers(Object.keys(VARIANTS), 4420);

const page = await openPage('about:blank', chromePath);
async function load(port, path) {
  let result;
  for (let i = 0; i < 2; i++) { // second load = warm cache
    const loaded = new Promise((r) => { const off = page.on('Page.loadEventFired', () => { off(); r(); }); });
    await page.send('Page.navigate', {url: `http://localhost:${port}${path}`});
    await loaded;
    result = await page.evaluate('window.__bench.done');
  }
  return result;
}

for (const {name: pageName, path} of PAGES) {
  console.log(`\n=== ${pageName} ===`);
  const results = {};
  for (const v of variants) results[v.name] = await load(v.port, path);
  const stockDom = results.stock.dom;
  console.table(Object.fromEntries(variants.map(({name}) => {
    const r = results[name];
    const writes = Object.entries(r.mutatedAttrs).sort(([, a], [, b]) => b.count - a.count);
    const changed = writes.reduce((n, [, m]) => n + m.count - m.sameValue, 0);
    return [name, {
      'attribute writes': r.attrWrites,
      'of which identical': r.attrWrites - changed,
      'top attributes': writes.slice(0, 4).map(([a, m]) => `${a} ${m.count}`).join(', '),
      'final DOM = stock': r.dom === stockDom ? 'yes' : 'NO',
    }];
  })));
  for (const {name} of variants) {
    if (results[name].dom === stockDom) continue;
    const a = stockDom.split('\n'), b = results[name].dom.split('\n');
    const i = a.findIndex((line, k) => line !== b[k]);
    console.log(`${name}: first DOM difference vs stock at line ${i}:\n  stock: ${a[i]?.slice(0, 200)}\n  ${name}: ${b[i]?.slice(0, 200)}`);
  }
  // Which attributes changed value (not identical writes), per variant.
  for (const {name} of variants) {
    const changed = Object.entries(results[name].mutatedAttrs).filter(([, m]) => m.count > m.sameValue);
    if (changed.length) {
      console.log(`${name}: value-changing writes: ` + changed.map(([a, m]) =>
        `${a} ×${m.count - m.sameValue} (e.g. ${JSON.stringify(m.example.from)?.slice(0, 40)} → ${JSON.stringify(m.example.to)?.slice(0, 40)})`).join('; '));
    }
  }
}
page.close();
stop();
setTimeout(() => process.exit(0), 300);
