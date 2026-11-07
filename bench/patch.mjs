// Applies / reverts patches to the published Angular bundles in node_modules.
//
// Slots (each is either stock or one of its options):
//   ngimg  on       The proposed fix: NgOptimizedImage#setHostAttribute skips the DOM write when
//                   the element already has that value (@angular/common).
//   core   compare  Exploratory, option B: on DOM nodes reused from the server during hydration,
//                   write a template's static attribute / class / style only if the DOM value
//                   differs. The final DOM is the same as today; only identical writes are dropped.
//          compare-inputs  `compare`, and leave alone static attributes a directive takes as an input.
//          skip     Exploratory, option A: on reused nodes, don't write static attributes / class /
//                   style at all (static `@animation` triggers are still registered).
//   bindings on     Exploratory: on reused nodes, [attr.x] and [prop] bindings skip a write whose
//                   value the DOM already has (needs a core option, which marks reused nodes).
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

/**
 * The core change on reused nodes: `compare` writes only what differs, `compare-inputs` also leaves
 * alone static attributes that a directive on the element takes as an input (the directive manages
 * them, so the server HTML already has their final value), `skip` writes nothing (except `@` props).
 */
const corePatched = (mode) => `// ngimg-hydration-repro: exploratory core change (${mode})
globalThis.__ngimgReproCore = '${mode}';
function ngimgReproStaticAttributesOnReusedNode(renderer, element, tNode) {
  const compare = ${mode !== 'skip'};
  const skipDirectiveInputs = ${mode === 'compare-inputs'};
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
        } else if (skipDirectiveInputs &&
            (tNode.inputs?.[attrName] || tNode.hostDirectiveInputs?.[attrName])) {
          // Taken as a directive input: the directive manages this attribute.
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
      // Remember nodes reused from the server, for the \`bindings\` patch.
      (globalThis.__ngimgReproReused ??= new WeakSet()).add(native);
    }
    if (getElementDepthCount() === 0`;

// --- bindings: the first write of [attr.x] and [prop] bindings on reused nodes -------------------
// Requires a core patch (which marks reused nodes). Compares the DOM before writing: attribute
// bindings against the attribute; property bindings against the live property, except URL
// properties, whose getter returns the resolved absolute URL, which are compared against the
// attribute instead.
const ATTR_BINDING_STOCK = `    const strValue = sanitizer == null ? renderStringify(value) : sanitizer(value, tagName || '', name);
    renderer.setAttribute(element, name, strValue, namespace);`;
const ATTR_BINDING_PATCHED = `    const strValue = sanitizer == null ? renderStringify(value) : sanitizer(value, tagName || '', name);
    // ngimg-hydration-repro: bindings change
    if (globalThis.__ngimgReproReused?.has(element) && !namespace && element.getAttribute(name) === strValue) {
      return;
    }
    renderer.setAttribute(element, name, strValue, namespace);`;
const PROP_BINDING_STOCK = `    value = unwrapImgVideoSrcValue(propName, element, value);
    renderer.setProperty(element, propName, value);`;
const PROP_BINDING_PATCHED = `    value = unwrapImgVideoSrcValue(propName, element, value);
    // ngimg-hydration-repro: bindings change
    if (globalThis.__ngimgReproReused?.has(element) && ngimgReproSameDomProperty(element, propName, value)) {
      return;
    }
    renderer.setProperty(element, propName, value);`;
const PROP_HELPER_STOCK = `function setDomProperty(tNode, lView, propName, value, renderer, sanitizer) {`;
const PROP_HELPER_PATCHED = `globalThis.__ngimgReproBindings = 'on';
const NGIMG_REPRO_URL_PROPS = new Set(['src', 'href', 'poster', 'data', 'action', 'formAction', 'cite']);
function ngimgReproSameDomProperty(element, propName, value) {
  if (NGIMG_REPRO_URL_PROPS.has(propName)) {
    return typeof value === 'string' && element.getAttribute(propName.toLowerCase()) === value;
  }
  return element[propName] === value;
}
function setDomProperty(tNode, lView, propName, value, renderer, sanitizer) {`;

// Each slot is stock or one of its options; a slot can patch several places (parts) in one file.
const SLOTS = {
  ngimg: {
    file: join(pkgDir('@angular/common'), 'fesm2022/common.mjs'),
    parts: [{
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
    }],
  },
  core: {
    file: join(pkgDir('@angular/core'), 'fesm2022/_debug_node-chunk.mjs'),
    parts: [{
      stock: CORE_STOCK,
      options: {
        'compare': corePatched('compare'),
        'compare-inputs': corePatched('compare-inputs'),
        'skip': corePatched('skip'),
      },
    }],
  },
  bindings: {
    file: join(pkgDir('@angular/core'), 'fesm2022/_debug_node-chunk.mjs'),
    parts: [
      {stock: ATTR_BINDING_STOCK, options: {on: ATTR_BINDING_PATCHED}},
      {stock: PROP_BINDING_STOCK, options: {on: PROP_BINDING_PATCHED}},
      {stock: PROP_HELPER_STOCK, options: {on: PROP_HELPER_PATCHED}},
    ],
  },
};

/** Build variants: the option each slot uses (slots not listed stay stock). */
export const VARIANTS = {
  'stock': {},
  'fixed': {ngimg: 'on'},
  'compare': {core: 'compare'},
  'fixed+compare': {ngimg: 'on', core: 'compare'},
  'fixed+compare-inputs': {ngimg: 'on', core: 'compare-inputs'},
  'fixed+skip': {ngimg: 'on', core: 'skip'},
  'fixed+compare+bindings': {ngimg: 'on', core: 'compare', bindings: 'on'},
  'fixed+compare-inputs+bindings': {ngimg: 'on', core: 'compare-inputs', bindings: 'on'},
};

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const count = (src, text) => src.split(text).length - 1;

export function status() {
  return Object.fromEntries(Object.entries(SLOTS).map(([slot, s]) => {
    const src = read(s.file);
    const options = Object.keys(s.parts[0].options);
    const option = options.find((o) => s.parts.every((p) => count(src, p.options[o]) === 1));
    if (option) return [slot, option];
    if (s.parts.every((p) => count(src, p.stock) === 1)) return [slot, 'stock'];
    throw new Error(`${slot}: patch target not found (exactly once) in ${s.file}; the Angular version may have changed.`);
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
    for (const p of s.parts) {
      if (current[slot] !== 'stock') src = src.replace(p.options[current[slot]], p.stock);
      if (want !== 'stock') src = src.replace(p.stock, p.options[want]);
    }
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
