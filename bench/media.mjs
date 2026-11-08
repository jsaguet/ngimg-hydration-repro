// Loads /media in each build and reports whether hydration restarted the videos, which are already
// playing when hydration starts (1.5 s after the window load event).
// Usage: node bench/media.mjs [--runs=3] [path-to-chrome]
import {fileURLToPath} from 'node:url';
import {openPage} from '../tools/cdp.mjs';
import {startServers} from '../tools/servers.mjs';
import {teeConsole} from '../tools/tee.mjs';
import {VARIANTS} from './patch.mjs';

const args = process.argv.slice(2);
const runsArg = args.find((a) => a.startsWith('--runs='));
const RUNS = runsArg ? Number(runsArg.split('=')[1]) : 3;
const chromePath = args.find((a) => !a.startsWith('--'));

teeConsole(fileURLToPath(new URL('../results/media.txt', import.meta.url)));
const {variants, stop} = await startServers(Object.keys(VARIANTS), 4440);
const page = await openPage('about:blank', chromePath);
console.log(`${page.product}. /media, hydration starts 1.5 s after load, ${RUNS} runs per build.`);
console.log('A video that keeps playing has a later position after hydration than before it.\n');

const rows = {};
for (const {name, port} of variants) {
  for (let run = 0; run < RUNS; run++) {
    const loaded = new Promise((r) => { const off = page.on('Page.loadEventFired', () => { off(); r(); }); });
    await page.send('Page.navigate', {url: `http://localhost:${port}/media?bootAfterLoad&bootDelay=1500`});
    await loaded;
    const result = await page.evaluate('window.__bench.done');
    for (const m of result.media) (rows[`${name} | ${m.case}`] ??= []).push(m);
  }
}
console.table(Object.fromEntries(Object.entries(rows).map(([key, media]) => [key, {
  'position before (s)': media.map((m) => m.timeBefore.toFixed(2)).join(' / '),
  'position after (s)': media.map((m) => m.timeAfter.toFixed(2)).join(' / '),
  'restarted': media.every((m) => m.emptied > 0) ? 'yes' : media.some((m) => m.emptied > 0) ? 'sometimes' : 'no',
  'src after hydration': media[0].src,
}])));
page.close();
stop();
setTimeout(() => process.exit(0), 300);
