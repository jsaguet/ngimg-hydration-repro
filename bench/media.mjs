// Loads /media in each build: three autoplaying videos (static src, [src], [attr.src]) are already
// playing when hydration starts (1.5 s after load). Reports whether hydration restarted them.
// Usage: node bench/media.mjs [--variants=a,b] [--runs=3] [path-to-chrome]
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {openPage} from '../tools/cdp.mjs';
import {VARIANTS as ALL_VARIANTS} from './patch.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const chromePath = args.find((a) => !a.startsWith('--'));
const RUNS = Number(opt('runs', 3));
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const variants = opt('variants', 'stock,compare,fixed+compare-inputs,fixed+skip').split(',')
  .map((name, i) => ({name, port: 4440 + i}));
if (variants.some((v) => !ALL_VARIANTS[v.name])) throw new Error('unknown variant');

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
console.log(`${page.product}: /media, hydration starts 1.5 s after load, ${RUNS} runs per build\n`);
const rows = {};
for (const {name, port} of variants) {
  for (let run = 0; run < RUNS; run++) {
    const loaded = new Promise((r) => { const off = page.on('Page.loadEventFired', () => { off(); r(); }); });
    await page.send('Page.navigate', {url: `http://localhost:${port}/media?bootAfterLoad&bootDelay=1500`});
    await loaded;
    const result = await page.evaluate('window.__bench.done');
    for (const m of result.media) {
      const key = `${name} | ${m.case}`;
      (rows[key] ??= []).push(m);
    }
  }
}
console.table(Object.fromEntries(Object.entries(rows).map(([key, ms]) => [key, {
  'playing before hydration': ms.every((m) => !m.pausedBefore) ? 'yes' : 'NO',
  'position before (s)': ms.map((m) => m.timeBefore.toFixed(2)).join(' / '),
  'position after (s)': ms.map((m) => m.timeAfter.toFixed(2)).join(' / '),
  'media load restarted (emptied, loadstart)': ms.map((m) => `${m.emptied},${m.loadstart}`).join(' / '),
  'after hydration: src | data-platform | title': `${ms[0].src} | ${ms[0].platform} | ${ms[0].title}`,
}])));
page.close();
setTimeout(() => process.exit(0), 300);
