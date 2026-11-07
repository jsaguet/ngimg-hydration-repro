// Loads each page once per build (untimed, attribute MutationObserver on) and prints which DOM
// writes happened during hydration, and whether the hydrated DOM is identical to the stock build's.
// Usage: node bench/inspect.mjs [path-to-chrome]
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {openPage} from '../tools/cdp.mjs';
import {VARIANTS} from './patch.mjs';

const chromePath = process.argv[2];
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PAGES = [
  {name: 'product grid (200 images)', path: '/?bootAfterLoad&inspect'},
  {name: 'data table (300 rows, 2 images)', path: '/table?bootAfterLoad&inspect'},
];

const variants = Object.keys(VARIANTS).map((name, i) => ({name, port: 4420 + i}));
const servers = variants.map(({name, port}) =>
  spawn(process.execPath, [join(root, 'dist', name, 'server', 'server.mjs')],
    {env: {...process.env, PORT: String(port)}, stdio: 'ignore'}));
process.on('exit', () => servers.forEach((s) => s.kill()));
for (const {name, port} of variants) {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${port}/img/ping`)).ok) break; } catch {}
    if (i > 100) throw new Error(`dist/${name} server did not start (run bench/build-variants.mjs)`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

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
      'img load events': r.imgLoadEvents,
      '(load) calls': r.loadHandlerCalls,
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
setTimeout(() => process.exit(0), 300);
