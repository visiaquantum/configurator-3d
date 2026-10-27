import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Gzip budget for the published bundle. Raise it deliberately, in the same
// change that explains why the library grew.
const BUDGET_KB = 60
const bundle = new URL('../dist/configurator-3d.js', import.meta.url)
const size = gzipSync(await readFile(bundle)).length / 1024
console.log(`dist/configurator-3d.js: ${size.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB)`)
if (size > BUDGET_KB) {
  console.error('Bundle over budget')
  process.exit(1)
}
