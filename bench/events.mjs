// Reports how many times event handlers run for things that happened before hydration, with event
// replay on (the default) and off. Writes results/events.txt.
// Usage: node bench/events.mjs [path-to-chrome]
import {fileURLToPath} from 'node:url';
import {openPage} from '../tools/cdp.mjs';
import {startServers} from '../tools/servers.mjs';
import {teeConsole} from '../tools/tee.mjs';
import {VARIANTS} from './patch.mjs';

teeConsole(fileURLToPath(new URL('../results/events.txt', import.meta.url)));
const page = await openPage('about:blank', process.argv[2]);
console.log(`${page.product}. Handler calls for events that fired before hydration.\n`);

async function load(url) {
  let result;
  for (let i = 0; i < 2; i++) { // The second load has a warm cache.
    const loaded = new Promise((r) => { const off = page.on('Page.loadEventFired', () => { off(); r(); }); });
    await page.send('Page.navigate', {url});
    await loaded;
    result = await page.evaluate('window.__bench.done');
  }
  return result;
}

const rows = {};
let firstPort = 4600;
for (const replay of [true, false]) {
  const {variants, stop} = await startServers(Object.keys(VARIANTS), firstPort, replay ? {} : {NO_REPLAY: '1'});
  firstPort += 10;
  const query = replay ? '' : '&noReplay';
  for (const {name, port} of variants) {
    const grid = await load(`http://localhost:${port}/?bootAfterLoad${query}`);
    await load(`http://localhost:${port}/media?bootAfterLoad&bootDelay=1500${query}`);
    const handlers = await page.evaluate('window.__handlers ?? {}');
    rows[`${name}, event replay ${replay ? 'on' : 'off'}`] = {
      'NgOptimizedImage (load), 30 images': grid.loadHandlerCalls,
      'plain <img> (load), 1 image': handlers.load ?? 0,
      'video (canplay), 1 video': handlers.canplay ?? 0,
    };
  }
  stop();
}
console.table(rows);
page.close();
setTimeout(() => process.exit(0), 300);
