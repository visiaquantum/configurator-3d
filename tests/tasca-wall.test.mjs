import { test, beforeAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { parseAssemblyManifest, parseCatalog, parseProject, validateConfiguration, extractItemSnapsFromObject, extractRulesFromObject } from '../src/lib/index.ts'
import { prepareProductAsset } from '../src/lib/scene/productAsset.ts'
import { visibleBodyBounds } from '../src/lib/scene/geometry.ts'
import { pairSpacingOptions } from '../src/lib/assembly/pairSpacing.ts'
import { TASCA_CATALOG_GROUPS, IVECO_ENCLOSURE, BAY_WIDTH, buildTascaWall, tascaWallContext } from '../src/tascaWall.ts'

// The quoted wall (99003819) composed from the real customer GLBs: every
// catalogue seat must sit on the CAD's 36 mm hole grid, and the composed
// element must validate inside the van with every part bolted at both ends.

const PITCH = 0.036
const catalog = TASCA_CATALOG_GROUPS.flatMap((group) => group.items)
const loaded = {}
const context = { catalog, itemSnaps: {}, itemRules: {}, manifest: null }

const load = async (url) => {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url))
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
}

beforeAll(async () => {
  context.manifest = parseAssemblyManifest(await readFile(new URL('../public/catalog/assembly-manifest.json', import.meta.url), 'utf8'))
  for (const product of catalog) {
    const scene = await load(product.glbUrl)
    const { metadata } = prepareProductAsset(scene, product)
    loaded[product.id] = { scene, metadata }
    context.itemSnaps[product.id] = metadata.snaps
    context.itemRules[product.id] = metadata.rules
  }
}, 120_000)

test('every manifest connector of the wall resolves to a hydrated snap point', () => {
  for (const product of catalog) {
    const definition = context.manifest.products.find((p) => p.catalogId === product.id)
    assert.ok(definition, `${product.id} is in the manifest`)
    for (const connector of definition.connectors) {
      const found = context.itemSnaps[product.id].some((point) => connector.snapId ? point.id === connector.snapId : point.kind === connector.snapKind)
      assert.ok(found, `${product.id}:${connector.id}`)
    }
  }
})

test('catalogue sizes are the visible bodies of the GLBs', () => {
  for (const product of catalog) {
    const size = visibleBodyBounds(loaded[product.id].scene).getSize(new Vector3()).toArray()
    product.size.forEach((value, i) => assert.ok(Math.abs(value - size[i]) < 1e-3, `${product.id} size[${i}] ${value} vs ${size[i]}`))
  }
})

test('every CAD mounting marker lands on the hole grid of a catalogue seat', () => {
  for (const product of catalog) {
    const bounds = visibleBodyBounds(loaded[product.id].scene)
    const center = bounds.getCenter(new Vector3())
    const markers = extractItemSnapsFromObject(loaded[product.id].scene).filter((point) => point.kind === 'frontale')
    const seats = product.snapPoints.filter((point) => point.kind === 'frontale')
    for (const marker of markers) {
      const local = marker.position.map((value, i) => value - center.getComponent(i))
      // Ends are symmetric, so X and Z compare by magnitude; Y up to whole pitches.
      const onGrid = seats.some((seat) => {
        const steps = (local[1] - seat.position[1]) / PITCH
        return Math.abs(steps - Math.round(steps)) * PITCH < 1e-3 &&
          [0, 2].every((i) => Math.abs(Math.abs(local[i]) - Math.abs(seat.position[i])) < 1e-3)
      })
      assert.ok(onGrid, `${product.id} marker ${marker.id} at ${local.map((v) => v.toFixed(4))} is off every seat`)
    }
  }
})

test('the side panels read their mirror rule from the node name, oriented by the catalogue', () => {
  for (const id of ['ysi03036', 'ysi01131']) {
    const rule = context.itemRules[id].find((r) => r.rule === 'mirror-pair')
    assert.ok(rule, id)
    assert.deepEqual(rule.axis, [0, 0, -1])
    assert.deepEqual(rule.params.distances, [0.254, 0.507, 0.761, 1.014, 1.268, 1.521])
  }
  const raw = new Group()
  const node = new Group(); node.name = 'RULE_MIRRORPAIR_D2541014'; node.userData = { name: 'RULE_MIRRORPAIR_D254.1014-3' }
  raw.add(node)
  assert.deepEqual(extractRulesFromObject(raw)[0].extracted.params, { distances: [0.254, 1.014] })
  const other = new Group(); other.name = 'RULE_AUTOSNAPGRID_D10'; raw.add(other)
  assert.equal(extractRulesFromObject(raw).length, 1)
  // A catalogue loaded from JSON keeps the correction (zod drops unknown keys).
  assert.deepEqual(parseCatalog(JSON.stringify(catalog)).find((p) => p.id === 'ysi03036').mirrorPair, { axis: [0, 0, -1] })
})

test('the 1014 bay spacing seats every part of the series', () => {
  const option = pairSpacingOptions('ysi03036', {
    catalog: Object.fromEntries(catalog.map((p) => [p.id, p])),
    itemSnaps: context.itemSnaps,
    itemRules: context.itemRules,
    manifest: context.manifest,
  }).find((o) => Math.abs(o.distance - BAY_WIDTH) < 1e-6)
  assert.ok(option)
  for (const part of ['kdw40236', 'kdw40636', 'kld41000', 'xla40400', 'kma40100']) {
    assert.ok(option.fits.includes(catalog.find((p) => p.id === part).label), part)
  }
})

test('the quoted wall composes, bolts at both ends and validates inside the van', () => {
  const project = buildTascaWall(context)
  const byId = Object.fromEntries(project.items.map((item) => [item.id, item]))
  const height = (id) => catalog.find((p) => p.id === byId[id].catalogId).size[1]
  const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol

  assert.equal(project.items.length, 14)
  // Panels: 1080 + 396 stacked from the van floor, front edges aligned.
  assert.ok(near(byId['fianco-basso'].position[1], 0.012))
  assert.ok(near(byId['fianco-alto'].position[1], 0.012 + 1.08))
  assert.ok(near(byId['fianco-alto-specchiato'].position[1], 0.012 + 1.08))
  assert.ok(near(byId['fianco-basso'].position[0] - 0.363 / 2, byId['fianco-alto'].position[0] - 0.313 / 2))
  // One pitch free under the door, the lower panel filled to the top, the
  // MultiBox on the upper panel's head.
  assert.ok(near(byId['antina-inferiore'].position[1] + height('antina-inferiore') / 2 - 0.1758 + 0.3588, 0.012 + 11 * PITCH, 1.5e-3))
  assert.ok(near(byId['angolare-leggero'].position[1] + height('angolare-leggero'), 0.012 + 1.08, 1.5e-3))
  assert.ok(near(byId.cassettiera.position[1], 0.012 + 1.08 + 0.396))
  // Front-facing parts look into the aisle (-X), the rear angle at the wall.
  for (const id of ['cassetto-64', 'antina-inferiore', 'antina-superiore', 'angolare-anteriore', 'cassettiera']) {
    assert.ok(near(Math.sin(byId[id].rotation[1]), -1), `${id} yaw ${byId[id].rotation[1]}`)
  }
  assert.ok(near(Math.sin(byId['angolare-posteriore'].rotation[1]), 1))

  // Ten parts at both ends, plus the two upper panels on the lower ones.
  assert.equal(project.connections.length, 22, JSON.stringify(project.connections.map((c) => `${c.sourceItemId}:${c.sourcePointId}->${c.targetItemId}:${c.targetPointId}`)))
  for (const placement of project.items.filter((item) => !item.catalogId.startsWith('ysi'))) {
    const ends = project.connections.filter((c) => c.sourceItemId === placement.id).map((c) => c.targetItemId).sort()
    assert.equal(ends.length, 2, placement.id)
    assert.notEqual(ends[0].replace('-specchiato', ''), ends[1], placement.id)
  }

  const [w, h, d] = IVECO_ENCLOSURE.dimensions
  const issues = validateConfiguration(project, Object.fromEntries(catalog.map((p) => [p.id, p])), context.manifest, {
    itemSnaps: context.itemSnaps,
    itemRules: context.itemRules,
    enclosureBounds: { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
  })
  assert.deepEqual(issues.filter((issue) => issue.level === 'error'), [])

  // The project survives a save/load round trip with its joints.
  const { project: reloaded } = parseProject(JSON.stringify(project), { catalog })
  assert.equal(reloaded.connections.length, 22)
})

test('the demo builds the same wall without loading a single GLB', () => {
  const hydrated = buildTascaWall(context)
  const declared = buildTascaWall(tascaWallContext(catalog, context.manifest))
  assert.equal(declared.connections.length, hydrated.connections.length)
  declared.items.forEach((item, i) => item.position.forEach((value, axis) =>
    assert.ok(Math.abs(value - hydrated.items[i].position[axis]) < 1e-4, `${item.id}[${axis}]`)))
})
