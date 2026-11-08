// Builds the app once per variant (see VARIANTS in bench/patch.mjs) into dist/<variant>.
// node_modules is restored to the published packages afterwards.
// Usage: node bench/build-variants.mjs [variant...]
import {execSync} from 'node:child_process';
import {readdirSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setVariant, VARIANTS} from './patch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const only = process.argv.slice(2);

try {
  for (const [variant, fixes] of Object.entries(VARIANTS)) {
    if (only.length && !only.includes(variant)) continue;
    setVariant(variant);
    // The persistent build cache would otherwise reuse the previously linked Angular packages.
    rmSync(join(root, '.angular/cache'), {recursive: true, force: true});
    console.log(`\n> Building ${variant}`);
    execSync(`npx ng build --output-path=dist/${variant}`, {cwd: root, stdio: 'inherit'});

    // Check that the browser bundle contains the fixes this variant applies, and only those.
    const browser = join(root, 'dist', variant, 'browser');
    const js = readdirSync(browser).filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(browser, f), 'utf8')).join('\n');
    const directive = /getAttribute\(\w+\)!==\w+&&this\.renderer\.setAttribute\(this\.imgElement/.test(js);
    const core = js.includes('__coreFix');
    if (directive !== fixes.includes('directive') || core !== fixes.includes('core')) {
      throw new Error(`dist/${variant}: unexpected contents (directive fix: ${directive}, core fix: ${core})`);
    }
    console.log(`dist/${variant}: directive fix ${directive ? 'on' : 'off'}, core fix ${core ? 'on' : 'off'}`);
  }
} finally {
  setVariant('stock');
}
