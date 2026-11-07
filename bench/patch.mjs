// Applies / reverts patches to the published Angular bundles in node_modules.
//
// Slots (each is either stock or one of its options):
//   ngimg  on       The proposed fix: NgOptimizedImage#setHostAttribute skips the DOM write when
//                   the element already has that value (@angular/common).
//   core   compare  Exploratory, option B: on DOM nodes reused from the server during hydration,
//                   write a template's static attribute / class / style only if the DOM value
//                   differs. The final DOM is the same as today; only identical writes are dropped.
//          skip     Exploratory, option A: on reused nodes, don't write static attributes / class /
//                   style at all (static `@animation` triggers are still registered).
//
// Usage: node bench/patch.mjs status | apply <variant> | revert
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const CORE_STOCK = `function elementLikeStartShared(tNode, lView, index, name, locateOrCreateNativeNode) {
  const adjustedIndex = HEADER_OFFSET + index;
  const tView = lView[TVIEW$1];
  const native = locateOrCreateNativeNode(tView, lView, tNode, name, index);
  lView[adjustedIndex] = native;
  setCurrentTNode(tNode, true);
  const isElement = tNode.type === 2;
  if (isElement) {
    setupStaticAttributes(lView[RENDERER], native, tNode);
    if (getElementDepthCount() === 0`;

/** The core change: `compare` writes only what differs, `skip` writes nothing (except `@` props). */
const corePatched = (mode) => `// ngimg-hydration-repro: exploratory core change (${mode})
globalThis.__ngimgReproCore = '${mode}';
function ngimgReproStaticAttributesOnReusedNode(renderer, element, tNode) {
  const compare = ${mode === 'compare'};
  const {mergedAttrs: attrs, classes, styles} = tNode;
  if (attrs !== null) {
    let i = 0;
    while (i < attrs.length) {
      const value = attrs[i];
      if (typeof value === 'number') {
        if (value !== 0) {
          break;
        }
        i++;
        const namespaceURI = attrs[i++];
        const attrName = attrs[i++];
        const attrVal = attrs[i++];
        // Rare; keep today's behavior in compare mode.
        if (compare) {
          renderer.setAttribute(element, attrName, attrVal, namespaceURI);
        }
      } else {
        const attrName = value;
        const attrVal = attrs[++i];
        if (isAnimationProp(attrName)) {
          renderer.setProperty(element, attrName, attrVal);
        } else if (compare && element.getAttribute(attrName) !== attrVal) {
          renderer.setAttribute(element, attrName, attrVal);
        }
        i++;
      }
    }
  }
  if (compare && classes !== null && element.getAttribute('class') !== (classes === '' ? null : classes)) {
    writeDirectClass(renderer, element, classes);
  }
  if (compare && styles !== null && element.getAttribute('style') !== styles) {
    writeDirectStyle(renderer, element, styles);
  }
}
function elementLikeStartShared(tNode, lView, index, name, locateOrCreateNativeNode) {
  const adjustedIndex = HEADER_OFFSET + index;
  const tView = lView[TVIEW$1];
  const native = locateOrCreateNativeNode(tView, lView, tNode, name, index);
  lView[adjustedIndex] = native;
  setCurrentTNode(tNode, true);
  const isElement = tNode.type === 2;
  if (isElement) {
    if (wasLastNodeCreated()) {
      setupStaticAttributes(lView[RENDERER], native, tNode);
    } else {
      ngimgReproStaticAttributesOnReusedNode(lView[RENDERER], native, tNode);
    }
    if (getElementDepthCount() === 0`;

const SLOTS = {
  ngimg: {
    file: join(pkgDir('@angular/common'), 'fesm2022/common.mjs'),
    stock: `  setHostAttribute(name, value) {
    this.renderer.setAttribute(this.imgElement, name, value);
  }`,
    options: {
      on: `  setHostAttribute(name, value) {
    // ngimg-hydration-repro: proposed fix
    if (this.imgElement.getAttribute(name) !== value) {
      this.renderer.setAttribute(this.imgElement, name, value);
    }
  }`,
    },
  },
  core: {
    file: join(pkgDir('@angular/core'), 'fesm2022/_debug_node-chunk.mjs'),
    stock: CORE_STOCK,
    options: {compare: corePatched('compare'), skip: corePatched('skip')},
  },
};

/** Build variants: the option each slot uses (slots not listed stay stock). */
export const VARIANTS = {
  'stock': {},
  'fixed': {ngimg: 'on'},
  'compare': {core: 'compare'},
  'fixed+compare': {ngimg: 'on', core: 'compare'},
  'fixed+skip': {ngimg: 'on', core: 'skip'},
};

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

export function status() {
  return Object.fromEntries(Object.entries(SLOTS).map(([slot, s]) => {
    const src = read(s.file);
    const option = Object.entries(s.options).find(([, text]) => src.includes(text))?.[0];
    if (option) return [slot, option];
    if (src.includes(s.stock)) return [slot, 'stock'];
    throw new Error(`${slot}: patch target not found in ${s.file}; the Angular version may have changed.`);
  }));
}

export function setVariant(variant) {
  const wanted = VARIANTS[variant];
  if (!wanted) throw new Error(`unknown variant ${variant}`);
  const current = status();
  for (const [slot, s] of Object.entries(SLOTS)) {
    const want = wanted[slot] ?? 'stock';
    if (current[slot] === want) continue;
    let src = read(s.file);
    if (current[slot] !== 'stock') src = src.replace(s.options[current[slot]], s.stock);
    if (want !== 'stock') src = src.replace(s.stock, s.options[want]);
    writeFileSync(s.file, src);
  }
  const after = status();
  for (const slot of Object.keys(SLOTS)) {
    if (after[slot] !== (wanted[slot] ?? 'stock')) throw new Error(`failed to set ${slot} for ${variant}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd = 'status', variant] = process.argv.slice(2);
  if (cmd === 'apply') setVariant(variant ?? 'fixed');
  else if (cmd === 'revert') setVariant('stock');
  console.log(status());
}
