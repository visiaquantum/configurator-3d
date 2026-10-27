import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The published bundle, not the sources: what a host imports must exist and
// must only reach declared peer dependencies.
const bundleUrl = new URL('../dist/configurator-3d.js', import.meta.url)

test('the built bundle exposes the public API', async () => {
  const library = await import(bundleUrl.href)
  for (const name of ['Configurator3D', 'createConfiguratorStore', 'parseProject', 'serializeProject', 'validateConfiguration',
    'jointsOf', 'selectJoints', 'VALIDATION_MESSAGES_IT', 'loadCatalog', 'loadAssemblyManifest', 'exportProjectPDF']) {
    assert.ok(name in library, `${name} is exported`)
  }
  const store = library.createConfiguratorStore()
  store.getState().setProject({ id: 'smoke', version: 1, enclosure: { glbUrl: '/van.glb' }, items: [] })
  assert.equal(store.getState().exportProject().id, 'smoke')
})

test('the built bundle imports only declared peer dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const peers = Object.keys(manifest.peerDependencies)
  const source = await readFile(bundleUrl, 'utf8')
  const specifiers = [...source.matchAll(/(?:from|import\()\s*["']([^"'./][^"']*)["']/g)].map((match) => match[1])
  for (const specifier of new Set(specifiers)) {
    assert.ok(peers.some((peer) => specifier === peer || specifier.startsWith(`${peer}/`)), `${specifier} is a peer dependency`)
  }
})
