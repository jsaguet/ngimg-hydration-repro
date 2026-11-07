// Builds the app once per variant (see VARIANTS in bench/patch.mjs) into dist/<variant>.
// node_modules is always restored to stock afterwards.
// Usage: node bench/build-variants.mjs [variant...]
import {execSync} from 'node:child_process';
import {readdirSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {setVariant, VARIANTS} from './patch.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const only = process.argv.slice(2);

try {
  for (const [variant, slots] of Object.entries(VARIANTS)) {
    if (only.length && !only.includes(variant)) continue;
    setVariant(variant);
    // The persistent build cache would otherwise reuse the previously linked Angular packages.
    rmSync(join(root, '.angular/cache'), {recursive: true, force: true});
    console.log(`\n> building ${variant}`);
    execSync(`npx ng build --output-path=dist/${variant}`, {cwd: root, stdio: 'inherit'});

    // Sanity check: each patch must be in the browser bundle iff the variant applies it.
    const browser = join(root, 'dist', variant, 'browser');
    const js = readdirSync(browser).filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(browser, f), 'utf8')).join('\n');
    const ngimg = /getAttribute\(\w+\)!==\w+&&this\.renderer\.setAttribute\(this\.imgElement/.test(js);
    const core = js.match(/__ngimgReproCore\s*=\s*"(\w+)"/)?.[1] ?? 'stock';
    if (ngimg !== (slots.ngimg === 'on') || core !== (slots.core ?? 'stock')) {
      throw new Error(`dist/${variant}: unexpected bundle contents (ngimg fix: ${ngimg}, core: ${core})`);
    }
    console.log(`dist/${variant}: NgOptimizedImage fix ${ngimg ? 'on' : 'off'}, core ${core} (as expected)`);
  }
} finally {
  setVariant('stock');
}
