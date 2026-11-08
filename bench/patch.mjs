// Applies the two fixes to the published Angular bundles in node_modules, so that the app can be
// built with and without them. Each edit reproduces the matching change on the angular repo:
//
//   directive  packages/common/src/directives/ng_optimized_image/ng_optimized_image.ts
//   core       packages/core/src/render3 (instructions/shared.ts, dom_node_manipulation.ts,
//              util/attrs_utils.ts)
//
// Usage: node bench/patch.mjs status | apply <variant> | revert
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const COMMON = join(pkgDir('@angular/common'), 'fesm2022/common.mjs');
const CORE = join(pkgDir('@angular/core'), 'fesm2022/_debug_node-chunk.mjs');

// Each edit is [file, published code, patched code].
const FIXES = {
  directive: [
    [
      COMMON,
      `  setHostAttribute(name, value) {
    this.renderer.setAttribute(this.imgElement, name, value);
  }`,
      `  setHostAttribute(name, value) {
    if (this.imgElement.getAttribute(name) !== value) {
      this.renderer.setAttribute(this.imgElement, name, value);
    }
  }`,
    ],
    [
      COMMON,
      `    this.destroyRef.onDestroy(() => {
      removeLoadListenerFn();
      removeErrorListenerFn();
    });
    callOnLoadIfImageIsLoaded(img, callback);
  }`,
      `    this.destroyRef.onDestroy(() => {
      removeLoadListenerFn();
      removeErrorListenerFn();
    });
    callOnLoadIfImageIsLoaded(img, callback);
    if (img.complete && !img.naturalWidth && img.currentSrc) {
      callback();
    }
  }`,
    ],
  ],
  core: coreEdits([
      // Static attributes, class and style.
      [
        `    setupStaticAttributes(lView[RENDERER], native, tNode);
    if (getElementDepthCount() === 0`,
        `    setupStaticAttributes(lView[RENDERER], native, tNode, !wasLastNodeCreated());
    if (getElementDepthCount() === 0`,
      ],
      [
        `function setUpAttributes(renderer, native, attrs) {`,
        `function setUpAttributes(renderer, native, attrs, skipIfUnchanged = false) {`,
      ],
      [
        `      if (isAnimationProp(attrName)) {
        renderer.setProperty(native, attrName, attrVal);
      } else {
        renderer.setAttribute(native, attrName, attrVal);
      }`,
        `      if (isAnimationProp(attrName)) {
        renderer.setProperty(native, attrName, attrVal);
      } else if (!skipIfUnchanged || native.getAttribute(attrName) !== String(attrVal)) {
        renderer.setAttribute(native, attrName, attrVal);
      }`,
      ],
      [
        `function setupStaticAttributes(renderer, element, tNode) {
  const {
    mergedAttrs,
    classes,
    styles
  } = tNode;
  if (mergedAttrs !== null) {
    setUpAttributes(renderer, element, mergedAttrs);
  }
  if (classes !== null) {
    writeDirectClass(renderer, element, classes);
  }
  if (styles !== null) {
    writeDirectStyle(renderer, element, styles);
  }
}`,
        `globalThis.__coreFix = true;
function setupStaticAttributes(renderer, element, tNode, skipIfUnchanged = false) {
  const {
    mergedAttrs,
    classes,
    styles
  } = tNode;
  if (mergedAttrs !== null) {
    setUpAttributes(renderer, element, mergedAttrs, skipIfUnchanged);
  }
  if (classes !== null && (!skipIfUnchanged || element.getAttribute('class') !== (classes || null))) {
    writeDirectClass(renderer, element, classes);
  }
  if (styles !== null && (!skipIfUnchanged || element.getAttribute('style') !== styles)) {
    writeDirectStyle(renderer, element, styles);
  }
}`,
      ],
      // Attribute bindings.
      [
        `function setElementAttribute(renderer, element, namespace, tagName, name, value, sanitizer) {`,
        `function setElementAttribute(renderer, element, namespace, tagName, name, value, sanitizer, skipIfUnchanged = false) {`,
      ],
      [
        `    renderer.setAttribute(element, name, strValue, namespace);`,
        `    if (!skipIfUnchanged || element.getAttribute(name) !== String(strValue)) {
      renderer.setAttribute(element, name, strValue, namespace);
    }`,
      ],
      [
        `  setElementAttribute(lView[RENDERER], element, namespace, tNode.value, name, value, sanitizer);`,
        `  setElementAttribute(lView[RENDERER], element, namespace, tNode.value, name, value, sanitizer, isFirstWriteOfRenderedResource(tNode, lView, name));`,
      ],
      // Property bindings.
      [
        `    value = unwrapImgVideoSrcValue(propName, element, value);
    renderer.setProperty(element, propName, value);`,
        `    value = unwrapImgVideoSrcValue(propName, element, value);
    if (!isFirstWriteOfRenderedResource(tNode, lView, propName) || element.getAttribute(propName) !== String(value)) {
      renderer.setProperty(element, propName, value);
    }`,
      ],
      [
        `function setDomProperty(tNode, lView, propName, value, renderer, sanitizer) {`,
        `function isFirstWriteOfRenderedResource(tNode, lView, name) {
  const tagName = tNode.value;
  return lView[HYDRATION] !== null && (lView[FLAGS] & 8) !== 0 &&
    (name === 'src' ? tagName === 'iframe' || tagName === 'embed' || tagName === 'video' || tagName === 'audio'
                    : name === 'data' && tagName === 'object');
}
function setDomProperty(tNode, lView, propName, value, renderer, sanitizer) {`,
      ],
  ]),
};

function coreEdits(edits) {
  return edits.map(([stock, patched]) => [CORE, stock, patched]);
}

/** The builds, and the fixes each one applies. */
export const VARIANTS = {
  'stock': [],
  'directive-fix': ['directive'],
  'core-fix': ['core'],
  'both-fixes': ['directive', 'core'],
};

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const count = (text, part) => text.split(part).length - 1;

/** Returns which fixes are applied in node_modules. */
export function status() {
  return Object.fromEntries(Object.entries(FIXES).map(([name, edits]) => {
    if (edits.every(([file, , patched]) => read(file).includes(patched))) return [name, 'applied'];
    if (edits.every(([file, stock]) => count(read(file), stock) === 1)) return [name, 'not applied'];
    throw new Error(`${name}: the code to patch was not found. Run npm ci.`);
  }));
}

export function setVariant(variant) {
  const wanted = VARIANTS[variant];
  if (!wanted) throw new Error(`Unknown variant: ${variant}`);
  const current = status();
  for (const [name, edits] of Object.entries(FIXES)) {
    const applied = current[name] === 'applied';
    if (applied === wanted.includes(name)) continue;
    for (const [file, stock, patched] of edits) {
      const source = read(file);
      writeFileSync(file, applied ? source.replace(patched, stock) : source.replace(stock, patched));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command = 'status', variant] = process.argv.slice(2);
  if (command === 'apply') setVariant(variant);
  else if (command === 'revert') setVariant('stock');
  console.log(status());
}
