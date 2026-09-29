#!/usr/bin/env node
/**
 * Patches rollup's native.js to fall back to WASM when the native binary
 * is blocked by Windows Application Control policies.
 *
 * Automatically run after `npm install` via the `postinstall` script.
 */

const fs = require('fs')
const path = require('path')

const nativePath = path.join(__dirname, '..', 'node_modules', 'rollup', 'dist', 'native.js')

if (!fs.existsSync(nativePath)) {
  console.log('[patch-rollup] rollup/dist/native.js not found, skipping patch.')
  process.exit(0)
}

const content = fs.readFileSync(nativePath, 'utf8')

const originalLoad = `const nativeModule = requireWithFriendlyError(
\texistsSync(path.join(__dirname, localName)) ? localName : \`@rollup/rollup-\${packageBase}\`
);`

const patchedLoad = `let nativeModule;
try {
\tnativeModule = requireWithFriendlyError(
\t\texistsSync(path.join(__dirname, localName)) ? localName : \`@rollup/rollup-\${packageBase}\`
\t);
} catch (_e) {
\ttry {
\t\tnativeModule = require('@rollup/wasm-node/dist/native.js');
\t} catch (_e2) {
\t\tthrow new Error('Failed to load rollup native module and WASM fallback. Please install @rollup/wasm-node.');
\t}
}`

if (content.includes('wasm-node/dist/native.js')) {
  console.log('[patch-rollup] Already patched, skipping.')
  process.exit(0)
}

if (!content.includes(originalLoad)) {
  console.log('[patch-rollup] Could not find target string in native.js. Rollup may have been updated. Skipping patch.')
  process.exit(0)
}

const patched = content.replace(originalLoad, patchedLoad)
fs.writeFileSync(nativePath, patched, 'utf8')
console.log('[patch-rollup] Successfully patched rollup/dist/native.js to use WASM fallback.')
