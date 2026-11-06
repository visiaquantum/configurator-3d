import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Nothing product-specific may feed the production path: the application and
// the library read products, rules and vehicles from the published catalogue
// only. The former demo data lives in tests/fixtures and is used by tests.

async function sources(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await sources(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

test('application and library carry no product data and import no test fixture', async () => {
  const manifest = JSON.parse(await readFile('catalog/manifest.json', 'utf8'))
  const ids = [...manifest.products.map((product) => product.catalogId), ...manifest.enclosures.map((vehicle) => vehicle.id)]
  const codes = [...manifest.products.map((product) => product.code), ...manifest.enclosures.map((vehicle) => vehicle.code)].filter(Boolean)
  const offenders = []
  for (const file of await sources('src')) {
    // Comments may name products as examples; code may not.
    const text = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')
    if (/fixtures|tascaWall|legacyDemo/.test(text)) offenders.push(`${file}: import di fixture`)
    for (const value of [...ids, ...codes]) {
      if (new RegExp(`['"\`/]${value.replace(/[-.]/g, '\\$&')}(['"\`/.]|\\.glb)`, 'i').test(text)) offenders.push(`${file}: ${value}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the application loads its catalogue from the published revision', async () => {
  const app = await readFile('src/App.tsx', 'utf8')
  assert.match(app, /loadCatalogRevision/)
  assert.match(app, /buildCatalogFromIndex/)
  // Only the public API: the application could live in another repository.
  assert.deepEqual([...new Set([...app.matchAll(/from '(\.[^']*)'/g)].map((match) => match[1]))], ['./lib'])
  const current = JSON.parse(await readFile('public/catalog/current.json', 'utf8'))
  const index = JSON.parse(await readFile(join('public/catalog', current.index), 'utf8'))
  const published = JSON.parse(await readFile(join('public/catalog', current.manifest), 'utf8'))
  const source = JSON.parse(await readFile('catalog/manifest.json', 'utf8'))
  // The published revision is the source manifest as it is now, over the files as they are now.
  assert.equal(index.revision, current.revision)
  assert.deepEqual({ ...published, revision: undefined }, { ...source, revision: undefined })
  const { createHash } = await import('node:crypto')
  for (const asset of [...index.products, ...index.enclosures]) {
    assert.equal(createHash('sha256').update(await readFile(join('public/models', asset.file))).digest('hex'), asset.sha256, asset.file)
  }
})
