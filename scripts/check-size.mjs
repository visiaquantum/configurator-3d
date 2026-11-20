import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Gzip budget for the published bundle. Raise it deliberately, in the same
// change that explains why the library grew. 60 → 72 kB: the catalogue
// builder and check (`buildCatalogFromIndex`, `checkCatalog`) ship with the
// library so the backend, the CLI and the client apply the same rules; an app
// that does not import them drops them when it bundles (`sideEffects: false`).
// 72 → 74 kB: validated stepping between support holes and the shared
// mouse/touch attachment preview and confirmation flow.
// 74 → 76 kB: seating a product on the vehicle's anchors, by its base points
// and at a distance from them (anchor stage of the guided attachment, its
// preview and containment, the distance fields).
const BUDGET_KB = 76
const bundle = new URL('../dist/configurator-3d.js', import.meta.url)
const size = gzipSync(await readFile(bundle)).length / 1024
console.log(`dist/configurator-3d.js: ${size.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB)`)
if (size > BUDGET_KB) {
  console.error('Bundle over budget')
  process.exit(1)
}
