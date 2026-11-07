// Runs the timing benchmark in headless Chrome. Usage: node dom-benchmark/run-headless.mjs [path-to-chrome]
import {openPage} from '../tools/cdp.mjs';
import {serve} from './serve.mjs';

const CONFIGS = [
  {images: 50, breakpoints: 16, samples: 15},
  {images: 200, breakpoints: 16, samples: 15},
  {images: 200, breakpoints: 32, samples: 15},
];

const server = await serve();
const page = await openPage(`http://127.0.0.1:${server.address().port}/`, process.argv[2]);
console.log(`${page.product}\n`);

const header = ({images, breakpoints, srcsetChars, samples}) =>
  `${images} images x ${breakpoints} breakpoints (srcset ${srcsetChars} chars), median of ${samples}, ms:`;

const BASE = 'current (no check)';
for (const cfg of CONFIGS) {
  const {config, results} = await page.evaluate(`runBench(${JSON.stringify(cfg)})`);
  console.log(header(config));
  const base = results[BASE].total;
  const compute = results['compute only'].total;
  console.table(Object.fromEntries(Object.entries(results).map(([n, r]) => [n, {
    'total': +r.total.toFixed(2),
    'vs current': n === BASE ? '' : `${((r.total / base - 1) * 100).toFixed(0)}%`,
    'DOM cost (total - compute)': n === 'compute only' ? '' : +(r.total - compute).toFixed(2),
    'attr mutations': r.mutations,
  }])));
  console.log();
}

// Per-attribute breakdown: what re-writing each single attribute costs on top of the full fix.
const {config, results} = await page.evaluate(
  `runBench(${JSON.stringify({images: 200, breakpoints: 16, samples: 25, breakdown: true})})`);
console.log('Per-attribute cost of an unconditional re-write, ' + header(config));
const fixed = results['fix all attributes'].total;
console.table(Object.fromEntries(Object.entries(results)
  .filter(([n]) => n.startsWith('rewrite '))
  .map(([n, r]) => [n.slice('rewrite '.length), {'extra ms vs full fix': +(r.total - fixed).toFixed(2)}])
  .sort(([, a], [, b]) => b['extra ms vs full fix'] - a['extra ms vs full fix'])));

page.close();
server.close();
