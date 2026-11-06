import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  buildCatalogFromIndex,
  checkCatalog,
  composeAssemblySample,
  correctionFor,
  extractAnchorsFromGLB,
  formatCatalogReport,
  holeColumnPositions,
  inspectSnapMarkers,
  loadCatalogRevision,
  catalogRevisionPointerUrl,
  CatalogRevisionError,
  normalizeProductCode,
  parseAssemblyManifest,
  parseProject,
  prepareProductAsset,
  productCompatibility,
  compatibleCatalogIds,
  resolveProductPoints,
  validateConfiguration,
  visibleBodyBounds,
} from '../src/lib/index.ts'
import { makeGlb, marker, parseGlb } from './helpers/glb.mjs'

// The production catalogue path on synthetic CAD exports: stable marker
// names, the manifest rules, the catalogue check and the publication.

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const near = (a, b, tol = 1e-6) => a.every((value, i) => Math.abs(value - b[i]) <= tol)

/** A 300 × 600 × 20 mm plate, front face at Z = 0, with the given markers. */
// Like a side panel: outer face at Z = 0, the bay (and the holes' mating direction) towards -Z.
const plate = (markers = []) => makeGlb([{ name: 'BODY', min: [0, 0, -0.02], max: [0.3, 0.6, 0] }, ...markers])
/** A 500 mm bar, ends at X = ±0.25; its brackets bear with their front face (Z = 0.01) 10 mm from each end. */
const ends = () => [marker('SNAP_FRONTALE__END_A', [-0.24, 0, 0.01]), marker('SNAP_FRONTALE__END_B', [0.24, 0, 0.01])]
const bar = (markers) => makeGlb([{ name: 'BAR', min: [-0.25, -0.01, -0.01], max: [0.25, 0.01, 0.01] }, ...markers])

async function assetOf(file, bytes) {
  const scene = await parseGlb(bytes)
  const bounds = visibleBodyBounds(scene)
  return {
    asset: { code: file.split('/').pop().replace('.glb', ''), file, url: `/models/${file}`, category: file.includes('/') ? file.split('/')[0] : '', sha256: sha(bytes), bytes: bytes.length, triangles: 12, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } },
    scene,
  }
}

const plateDefinition = (extra = {}) => ({
  catalogId: 'tst01', code: 'TST01', label: 'Piastra di prova', category: 'Prove',
  holeColumns: [{ id: 'front', kind: 'frontale', label: 'Foro', first: [0.3, 0.018, -0.01], pitch: [0, 0.036, 0], normal: [0, 0, -1], sheet: { outward: [1, 0, 0], thickness: 0.0015 } }],
  connectors: [{ id: 'plate-hole', snapKind: 'frontale', compatibleWith: ['bar-end'], capacity: 1, insertionDepth: 0.03, clearance: [{ id: 'slot', center: [0, 0, 0], size: [0.06, 0.06, 0.06] }] }],
  review: { confirmed: true, by: 'test' },
  ...extra,
})
const barDefinition = (extra = {}) => ({
  catalogId: 'bar02', code: 'BAR-02', label: 'Barra di prova', bays: [0.5],
  // Markers sit on the bracket's front face, so the face says +Z: the manifest gives the mating direction.
  directions: { end_a: [-1, 0, 0], end_b: [1, 0, 0] },
  connectors: [{ id: 'bar-end', snapKind: 'frontale', compatibleWith: ['plate-hole'], capacity: 1 }],
  review: { confirmed: true },
  ...extra,
})

test('product codes normalise to one catalogue id per product', () => {
  assert.equal(normalizeProductCode('PTBM-31.glb'), 'ptbm31')
  assert.equal(normalizeProductCode('KCP40531KMD02'), 'kcp40531kmd02')
  assert.equal(normalizeProductCode('kdw 40236'), normalizeProductCode('KDW40236'))
  // The manifest refuses a code that does not normalise to its catalogue id, and duplicates.
  assert.throws(() => parseAssemblyManifest({ version: 2, products: [{ catalogId: 'abc', code: 'XYZ', connectors: [] }] }), /normalises/)
  assert.throws(() => parseAssemblyManifest({ version: 2, products: [{ catalogId: 'ab1', code: 'AB-1', connectors: [] }, { catalogId: 'ab1', connectors: [] }] }), /Duplicate/)
  assert.throws(() => parseAssemblyManifest({ version: 2, products: [{ catalogId: 'p', connectors: [], holeColumns: [{ id: 'f', kind: 'frontale', first: [0, 0, 0], pitch: [0, 0, 0], normal: [0, 0, 1] }] }] }), /zero/)
})

test('a hole column is generated from origin, pitch and count, onto the inner face of the sheet', () => {
  const bounds = { min: [0, 0, -0.029], max: [0.363, 1.08, 0] }
  const column = { id: 'front', kind: 'frontale', first: [0.363, 0.018, -0.017], pitch: [0, 0.036, 0], normal: [0, 0, -1], sheet: { outward: [1, 0, 0], thickness: 0.0015 } }
  const holes = holeColumnPositions(column, bounds)
  // As many as fit in the body: 18 mm, 54 mm … 1062 mm.
  assert.equal(holes.length, 30)
  assert.ok(near(holes[0], [0.3615, 0.018, -0.017]))
  assert.ok(near(holes[29], [0.3615, 1.062, -0.017]))
  assert.equal(holeColumnPositions({ ...column, count: 3 }, bounds).length, 3)
  assert.equal(holeColumnPositions({ ...column, length: 0.072 }, bounds).length, 3)
  // A downward column counts within the body too; a column starting outside is empty.
  assert.equal(holeColumnPositions({ ...column, first: [0.363, 1.062, -0.017], pitch: [0, -0.036, 0] }, bounds).length, 30)
  assert.equal(holeColumnPositions({ ...column, first: [0.363, 2, -0.017] }, bounds).length, 0)
  // Without a sheet the holes stay on the outer face.
  assert.ok(near(holeColumnPositions({ ...column, sheet: undefined }, bounds)[0], [0.363, 0.018, -0.017]))
})

test('manifest points move into the collider frame; a correction applies to its own file only', async () => {
  const { asset } = await assetOf('PROVE/TST01.glb', plate())
  const definition = plateDefinition({
    points: [{ id: 'top', kind: 'appoggio', position: [0.3, 0.6, -0.01], normal: [0, 0, 2] }],
    assetCorrections: [{ asset: asset.sha256.slice(0, 16), reason: 'prova', scale: 2, points: [{ id: 'base', kind: 'terra', position: [0.15, 0, -0.01] }] }],
  })
  const resolved = resolveProductPoints(definition, asset)
  assert.equal(resolved.scale, 2)
  assert.deepEqual(resolved.replaceKinds.sort(), ['frontale', 'terra'])
  const byId = Object.fromEntries(resolved.points.map((point) => [point.id, point]))
  // Centre (0.15, 0.3, -0.01), then × scale 2; directions become unit vectors.
  assert.ok(near(byId.top.position, [0.3, 0.6, 0]))
  assert.deepEqual(byId.top.normal, [0, 0, 1])
  assert.ok(near(byId['front-1'].position, [(0.2985 - 0.15) * 2, (0.018 - 0.3) * 2, 0]))
  assert.equal(byId['front-1'].label, 'Foro 1')
  assert.ok(byId.base)
  // Another file: the correction is reported, not applied.
  const other = resolveProductPoints(definition, { ...asset, sha256: 'f'.repeat(64) })
  assert.equal(other.scale, 1)
  assert.ok(!other.points.some((point) => point.id === 'base'))
  assert.equal(other.issues[0].reason, 'correction-stale')
  assert.deepEqual(correctionFor([{ asset: 'abc' }], 'abcdef').stale, [])
})

test('the catalogue is built from the files and the manifest alone', async () => {
  const plateFile = await assetOf('PROVE/TST01.glb', plate())
  const barFile = await assetOf('PROVE/BAR-02.glb', bar(ends()))
  const orphan = await assetOf('ORFANO.glb', plate())
  const manifest = parseAssemblyManifest({ version: 2, categories: { PROVE: 'Prodotti di prova' }, products: [plateDefinition(), barDefinition({ category: undefined }), { catalogId: 'ghost', connectors: [] }] })
  const built = buildCatalogFromIndex({ version: 1, revision: 'r1', products: [plateFile.asset, barFile.asset, orphan.asset], enclosures: [] }, manifest)
  assert.deepEqual(built.items.map((item) => item.id), ['tst01', 'bar02'])
  assert.deepEqual(built.categories, ['Prove', 'Prodotti di prova'])
  const item = built.items[0]
  assert.equal(item.label, 'Piastra di prova')
  assert.equal(item.code, 'TST01')
  assert.ok(near(item.size, [0.3, 0.6, 0.02]))
  assert.equal(item.snapPoints.length, 17)
  assert.deepEqual(built.issues.map((issue) => [issue.reason, issue.product]).sort(), [['asset-missing', 'ghost'], ['manifest-missing', 'orfano']])
})

test('stable marker names give stable ids; duplicates are caught before the loader renames them', async () => {
  const exported = await parseGlb(bar([
    marker('SNAP_FRONTALE__END_A', [-0.25, 0, 0]),
    marker('SNAP_FRONTALE__END_B', [0.25, 0, 0]),
    marker('SNAP_TERRA-3', [0, -0.01, 0]),
  ]))
  const report = inspectSnapMarkers(exported)
  assert.deepEqual(report.points.map((point) => [point.id, point.kind, point.stable]), [['end_a', 'frontale', true], ['end_b', 'frontale', true], ['terra', 'terra', false]])
  assert.deepEqual(report.legacy, ['SNAP_TERRA-3'])
  assert.deepEqual(report.duplicates, [])
  // Re-exported with the nodes in another order: the stable ids keep their points.
  const reexported = inspectSnapMarkers(await parseGlb(bar([
    marker('SNAP_TERRA-3', [0, -0.01, 0]),
    marker('SNAP_FRONTALE__END_B', [0.25, 0, 0]),
    marker('SNAP_FRONTALE__END_A', [-0.25, 0, 0]),
  ])))
  for (const id of ['end_a', 'end_b']) {
    assert.deepEqual(reexported.points.find((p) => p.id === id).position, report.points.find((p) => p.id === id).position)
  }
  // GLTFLoader turns the second name into `…_1`: the authored name still counts twice.
  const duplicated = await parseGlb(bar([marker('SNAP_FRONTALE__END_A', [-0.25, 0, 0]), marker('SNAP_FRONTALE__END_A', [0.25, 0, 0])]))
  assert.ok(duplicated.children.some((node) => node.name === 'SNAP_FRONTALE__END_A_1'))
  assert.deepEqual(inspectSnapMarkers(duplicated).duplicates, [{ id: 'end_a', names: ['SNAP_FRONTALE__END_A', 'SNAP_FRONTALE__END_A'] }])
  const malformed = inspectSnapMarkers(await parseGlb(bar([marker('SNAP_FRONTALE__FORO 12', [0.25, 0, 0]), marker('SNAP_FRONTALE.2', [-0.25, 0, 0])])))
  assert.deepEqual(malformed.malformed.sort(), ['SNAP_FRONTALE.2', 'SNAP_FRONTALE__FORO 12'])
})

test('preparation applies scale once, keeps stable GLB markers and the manifest direction', async () => {
  const bytes = bar([marker('SNAP_FRONTALE__END_A', [-0.25, 0, 0]), marker('SNAP_FRONTALE__END_B', [0.25, 0, 0]), marker('SNAP_LATERALE__TOP', [0, 0.01, 0.005])])
  const { asset, scene } = await assetOf('BAR-02.glb', bytes)
  const manifest = parseAssemblyManifest({ version: 2, products: [barDefinition({ directions: { top: [0, 0, 1] }, assetCorrections: [{ asset: asset.sha256.slice(0, 20), reason: 'esportato in decimetri', scale: 10 }] })] })
  const [item] = buildCatalogFromIndex({ version: 1, revision: 'r', products: [asset], enclosures: [] }, manifest).items
  const prepared = prepareProductAsset(scene, item)
  const byId = Object.fromEntries(prepared.metadata.snaps.map((point) => [point.id, point]))
  assert.ok(near(prepared.metadata.size, [5, 0.2, 0.2], 1e-6))
  assert.ok(near(byId.end_a.position, [-2.5, 0, 0], 1e-6), JSON.stringify(byId.end_a))
  assert.deepEqual(byId.end_a.normal, [-1, 0, 0])
  // On an edge the face is ambiguous; the manifest says which way it mates.
  assert.deepEqual(byId.top.normal, [0, 0, 1])
  // Hole columns replace only their own kind: a stable GLB marker of another kind survives.
  const plateFile = await assetOf('TST01.glb', plate([marker('SNAP_FRONTALE__OLD', [0.3, 0.018, -0.01]), marker('SNAP_APPOGGIO__TOP', [0.15, 0.6, -0.01])]))
  const [plateItem] = buildCatalogFromIndex({ version: 1, revision: 'r', products: [plateFile.asset], enclosures: [] }, parseAssemblyManifest({ version: 2, products: [plateDefinition()] })).items
  const plateSnaps = prepareProductAsset(plateFile.scene, plateItem).metadata.snaps
  assert.ok(!plateSnaps.some((point) => point.id === 'old'))
  assert.ok(plateSnaps.some((point) => point.id === 'top' && point.kind === 'appoggio'))
  assert.equal(plateSnaps.filter((point) => point.kind === 'frontale').length, 17)
})

test('vehicle anchors are the centres of their marker cubes', async () => {
  const van = await parseGlb(makeGlb([
    { name: 'Body', min: [-1, 0, -2], max: [1, 2, 2] },
    { name: 'anchor_RETRO_DX', min: [0.79, 0, 1.49], max: [0.81, 0.02, 1.51] },
    { name: 'anchor_empty', position: [0, 0.5, 0] },
  ]))
  const anchors = Object.fromEntries(extractAnchorsFromGLB(van).map((anchor) => [anchor.id, anchor]))
  assert.deepEqual(anchors.RETRO_DX.position, [0.8, 0.01, 1.5])
  assert.deepEqual(anchors.empty.position, [0, 0.5, 0])
})

test('compatibility is read off the manifest and explained', () => {
  const manifest = parseAssemblyManifest({ version: 2, products: [plateDefinition(), barDefinition(), { catalogId: 'solo', connectors: [] }, { catalogId: 'other', connectors: [{ id: 'x', snapKind: 'laterale' }] }] })
  assert.equal(productCompatibility(manifest, 'bar02', 'tst01').compatible, true)
  assert.deepEqual(productCompatibility(manifest, 'bar02', 'tst01').joints, [{ connector: 'bar-end', otherConnector: 'plate-hole' }])
  assert.equal(productCompatibility(manifest, 'bar02', 'solo').reason, 'no-connectors')
  assert.equal(productCompatibility(manifest, 'bar02', 'other').reason, 'incompatible-family')
  assert.equal(productCompatibility(manifest, 'bar02', 'missing').reason, 'not-in-manifest')
  assert.deepEqual(compatibleCatalogIds(manifest, 'tst01'), ['bar02'])
})

test('a project names its catalogue revision; another or none is reported on opening', () => {
  const project = { id: 'p', version: 1, enclosure: { glbUrl: '/van.glb' }, items: [], catalog: { revision: 'rev-a', enclosureId: 'van' } }
  assert.deepEqual(parseProject(project).project.catalog, { revision: 'rev-a', enclosureId: 'van' })
  assert.deepEqual(parseProject(project, { catalogRevision: 'rev-a' }).warnings, [])
  assert.match(parseProject(project, { catalogRevision: 'rev-b' }).warnings[0].message, /rev-a/)
  assert.match(parseProject({ ...project, catalog: undefined }, { catalogRevision: 'rev-b' }).warnings[0].message, /no catalogue revision/)
})

/** A folder with one plate and one bar, ready for the CLI tools. */
async function catalogFolder(t, { barMarkers, manifestProducts } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'catalogo-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'models', 'PROVE'), { recursive: true })
  await writeFile(join(root, 'models', 'PROVE', 'TST01.glb'), plate())
  await writeFile(join(root, 'models', 'PROVE', 'BAR-02.glb'), bar(barMarkers ?? ends()))
  const manifest = {
    version: 2, products: manifestProducts ?? [plateDefinition(), barDefinition()],
    samples: [{ id: 'coppia', label: 'Barra sulla piastra', steps: [{ id: 'piastra', product: 'tst01' }, { id: 'barra', product: 'bar02', point: 'end_a', on: 'piastra', at: 'front-3' }], expectConnections: 1 }],
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, models: join(root, 'models'), manifest: join(root, 'manifest.json'), out: join(root, 'catalog'), definition: manifest }
}

test('the catalogue check reports structural errors, geometric warnings and confirmations', async (t) => {
  const { runCatalogCheck } = await import('../scripts/catalog/check.mjs')
  const clean = await catalogFolder(t)
  const ok = (await runCatalogCheck(clean)).report
  assert.equal(ok.blocking, false, formatCatalogReport(ok))
  assert.deepEqual(ok.issues, [])

  // Every kind of broken folder, at once.
  const broken = await catalogFolder(t, {
    barMarkers: [marker('SNAP_FRONTALE__END_A', [-0.24, 0, 0.01]), marker('SNAP_FRONTALE__END_A', [0.24, 0, 0.01]), marker('SNAP_TERRA-1', [0, -0.012, 0]), marker('SNAP_LATERALE__SPIGOLO', [0.25, 0.01, 0.01])],
    manifestProducts: [
      plateDefinition({ review: undefined, connectors: [{ id: 'plate-hole', snapKind: 'frontale', compatibleWith: ['bar-end', 'nessuno'] }, { id: 'plate-top', snapId: 'top' }] }),
      barDefinition({ connectors: [{ id: 'bar-end', snapKind: 'frontale', compatibleWith: ['plate-hole'] }, { id: 'bar-side', snapKind: 'laterale' }] }),
      { catalogId: 'ghost', connectors: [] },
    ],
  })
  await writeFile(join(broken.models, 'ROTTO.glb'), 'not a glb')
  await mkdir(join(broken.models, 'ALTRO'))
  await writeFile(join(broken.models, 'ALTRO', 'TST01.glb'), plate())
  const { report } = await runCatalogCheck(broken)
  const codes = (severity) => [...new Set(report.issues.filter((entry) => entry.severity === severity).map((entry) => entry.code))].sort()
  assert.equal(report.blocking, true)
  assert.deepEqual(codes('error'), ['asset-missing', 'code-duplicate', 'glb-unreadable', 'manifest-missing', 'marker-duplicate', 'point-missing', 'reference-unknown', 'sample-invalid'].sort())
  assert.deepEqual(codes('warning'), ['direction-ambiguous', 'marker-legacy', 'marker-off-surface'])
  assert.deepEqual(codes('confirm'), ['review-pending'])
  // Each finding says where and what to do.
  const duplicate = report.issues.find((entry) => entry.code === 'marker-duplicate')
  assert.equal(duplicate.file, 'PROVE/BAR-02.glb')
  assert.equal(duplicate.point, 'end_a')
  assert.match(duplicate.action, /nome unico/)
  assert.match(formatCatalogReport(report), /ESITO: NON PUBBLICABILE/)

  // A manifest that does not parse is blocking too, with the field path.
  await writeFile(broken.manifest, JSON.stringify({ version: 2, products: [{ catalogId: 'x' }] }))
  const invalid = (await runCatalogCheck(broken)).report
  assert.equal(invalid.issues[0].code, 'manifest-invalid')
  assert.equal(invalid.issues[0].point, '$.products.0.connectors')
})

test('a sample assembly catches a part that reaches past the sheet', async () => {
  const bytes = bar([])
  const plateFile = await assetOf('TST01.glb', plate())
  const barFile = await assetOf('BAR-02.glb', bytes)
  // The bracket's front face bears on the sheet's inner face and passes; 1 mm further forward, it shows through.
  const manifestFor = (front) => parseAssemblyManifest({
    version: 2,
    products: [plateDefinition(), barDefinition({ points: [{ id: 'end-a', kind: 'frontale', position: [-0.24, 0, front], normal: [-1, 0, 0] }] })],
    samples: [{ id: 's', label: 'Barra', steps: [{ id: 'piastra', product: 'tst01' }, { id: 'barra', product: 'bar02', point: 'end-a', on: 'piastra', at: 'front-3' }] }],
  })
  const run = (front) => checkCatalog({
    index: { version: 1, revision: 'r', products: [plateFile.asset, barFile.asset], enclosures: [] },
    manifest: manifestFor(front), models: { 'TST01.glb': plateFile.scene, 'BAR-02.glb': barFile.scene },
  })
  assert.deepEqual(run(0.01).issues.filter((entry) => entry.severity === 'error'), [])
  const reaching = run(0.009).issues.filter((entry) => entry.code === 'sheet-overlap')
  assert.equal(reaching.length, 1)
  assert.match(reaching[0].message, /1\.00 mm oltre la lamiera/)
})

test('publication is refused with blocking errors, records the report and rolls back only to intact revisions', async (t) => {
  const { publishCatalog, rollbackCatalog } = await import('../scripts/catalog/publish.mjs')
  const log = () => {}
  const folder = await catalogFolder(t, { manifestProducts: [plateDefinition({ connectors: [{ id: 'plate-hole', snapId: 'missing' }] }), barDefinition()] })
  const refused = await publishCatalog({ ...folder, previews: false, log })
  assert.equal(refused.published, false)
  await assert.rejects(readFile(join(folder.out, 'current.json')))

  const clean = { ...folder.definition, products: [plateDefinition(), barDefinition()] }
  await writeFile(folder.manifest, JSON.stringify(clean))
  const first = await publishCatalog({ ...folder, previews: false, log })
  assert.equal(first.published, true)
  const current = JSON.parse(await readFile(join(folder.out, 'current.json'), 'utf8'))
  assert.equal(current.revision, first.revision)
  assert.equal(JSON.parse(await readFile(join(folder.out, 'revisions', first.revision, 'report.json'), 'utf8')).blocking, false)
  // The same content is the same revision.
  assert.equal((await publishCatalog({ ...folder, previews: false, log })).revision, first.revision)

  // Adding a product is a GLB and a manifest entry: no code changes.
  await cp(join(folder.models, 'PROVE', 'BAR-02.glb'), join(folder.models, 'PROVE', 'BAR-03.glb'))
  await writeFile(folder.manifest, JSON.stringify({ ...clean, products: [...clean.products, barDefinition({ catalogId: 'bar03', code: 'BAR-03', label: 'Barra nuova' })] }))
  const second = await publishCatalog({ ...folder, previews: false, log })
  assert.notEqual(second.revision, first.revision)

  // The client loads the published revision through its pointer and builds the catalogue.
  const fetchFile = async (url) => {
    const path = decodeURIComponent(new URL(url).pathname)
    try { const text = await readFile(path, 'utf8'); return { ok: true, status: 200, text: async () => text } } catch { return { ok: false, status: 404, text: async () => '' } }
  }
  const currentUrl = `file://${join(folder.out, 'current.json')}`
  const loaded = await loadCatalogRevision(currentUrl, { fetch: fetchFile })
  assert.equal(loaded.index.revision, second.revision)
  const built = buildCatalogFromIndex(loaded.index, loaded.manifest)
  assert.ok(built.items.some((item) => item.id === 'bar03' && item.label === 'Barra nuova'))
  assert.ok(built.items[0].glbUrl.startsWith('file://') && built.items[0].glbUrl.includes('?v='))
  // An older revision is still reachable by id; an unknown one is reported as such.
  const old = await loadCatalogRevision(catalogRevisionPointerUrl(currentUrl, first.revision), { fetch: fetchFile })
  assert.ok(!buildCatalogFromIndex(old.index, old.manifest).items.some((item) => item.id === 'bar03'))
  await assert.rejects(loadCatalogRevision(catalogRevisionPointerUrl(currentUrl, 'rev-missing'), { fetch: fetchFile }), (error) => error instanceof CatalogRevisionError && error.code === 'unreachable')
  // A pointer naming another revision than its files is refused.
  const pointerPath = join(folder.out, 'revisions', first.revision, 'pointer.json')
  await writeFile(pointerPath, JSON.stringify({ ...JSON.parse(await readFile(pointerPath, 'utf8')), revision: 'rev-other' }))
  await assert.rejects(loadCatalogRevision(`file://${pointerPath}`, { fetch: fetchFile }), (error) => error.code === 'revision-mismatch')

  // Rolling back to the first revision works while its files are untouched…
  await rollbackCatalog({ revision: first.revision, models: folder.models, out: folder.out, log })
  assert.equal(JSON.parse(await readFile(join(folder.out, 'current.json'), 'utf8')).revision, first.revision)
  // …and is refused once a file of that revision has changed.
  await writeFile(join(folder.models, 'PROVE', 'TST01.glb'), plate([marker('SNAP_TERRA__BASE', [0.15, 0, -0.01])]))
  await assert.rejects(rollbackCatalog({ revision: second.revision, models: folder.models, out: folder.out, log }), /TST01\.glb modificato/)
  const history = JSON.parse(await readFile(join(folder.out, 'history.json'), 'utf8'))
  assert.deepEqual(history.map((entry) => entry.action), ['publish', 'publish', 'publish', 'rollback'])
})

test('a product re-exported with the same markers keeps the saved project valid and unchanged', async () => {
  // First export, a project composed on it; then the CAD exports the bar again, nodes reordered.
  const manifest = parseAssemblyManifest({ version: 2, products: [plateDefinition(), barDefinition()] })
  const plateFile = await assetOf('TST01.glb', plate())
  const before = await assetOf('BAR-02.glb', bar(ends()))
  const after = await assetOf('BAR-02.glb', bar([...ends()].reverse().concat([marker('SNAP_TERRA__PIEDE', [0, -0.01, 0])])))
  assert.notEqual(before.asset.sha256, after.asset.sha256)
  const contextFor = (barFile) => {
    const built = buildCatalogFromIndex({ version: 1, revision: barFile === before ? 'r1' : 'r2', products: [plateFile.asset, barFile.asset], enclosures: [] }, manifest)
    const ready = Object.fromEntries(built.items.map((item) => [item.id, prepareProductAsset(item.id === 'tst01' ? plateFile.scene : barFile.scene, item).metadata]))
    return {
      catalog: Object.fromEntries(built.items.map((item) => [item.id, item])), manifest,
      itemSnaps: Object.fromEntries(Object.entries(ready).map(([id, entry]) => [id, entry.snaps])),
      itemRules: Object.fromEntries(Object.entries(ready).map(([id, entry]) => [id, entry.rules])),
      itemSizes: Object.fromEntries(Object.entries(ready).map(([id, entry]) => [id, entry.size])),
    }
  }
  const sample = { id: 's', label: 'Barra', steps: [{ id: 'piastra', product: 'tst01' }, { id: 'barra', product: 'bar02', point: 'end_a', on: 'piastra', at: 'front-3' }] }
  const { project } = composeAssemblySample(sample, contextFor(before))
  assert.equal(project.connections.length, 1)
  const saved = parseProject(JSON.parse(JSON.stringify({ ...project, catalog: { revision: 'r1' } })), { catalogRevision: 'r2' })
  assert.match(saved.warnings[0].message, /r1/)
  const reexported = contextFor(after)
  const issues = validateConfiguration(saved.project, reexported.catalog, manifest, reexported)
  assert.deepEqual(issues.filter((issue) => issue.level === 'error'), [])
  // The same point ids, at the same place.
  for (const id of ['end_a', 'end_b']) {
    assert.deepEqual(reexported.itemSnaps.bar02.find((p) => p.id === id).position, contextFor(before).itemSnaps.bar02.find((p) => p.id === id).position)
  }
})
