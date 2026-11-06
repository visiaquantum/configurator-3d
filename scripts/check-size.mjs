import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Gzip budget for the published bundle. Raise it deliberately, in the same
// change that explains why the library grew. 60 → 72 kB: the catalogue
// builder and check (`buildCatalogFromIndex`, `checkCatalog`) ship with the
// library so the backend, the CLI and the client apply the same rules; an app
// that does not import them drops them when it bundles (`sideEffects: false`).
const BUDGET_KB = 72
const bundle = new URL('../dist/configurator-3d.js', import.meta.url)
const size = gzipSync(await readFile(bundle)).length / 1024
console.log(`dist/configurator-3d.js: ${size.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB)`)
if (size > BUDGET_KB) {
  console.error('Bundle over budget')
  process.exit(1)
}
