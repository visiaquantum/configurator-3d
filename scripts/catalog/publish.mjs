// Publish a catalogue revision, the reference implementation of what the
// backend does before the client may use new GLBs or a new manifest:
//
//   node scripts/catalog/publish.mjs [--models public/models] [--manifest catalog/manifest.json]
//                                    [--out public/catalog] [--no-previews]
//   node scripts/catalog/publish.mjs --rollback <revision> [--out public/catalog]
//
// A revision with blocking errors is never published; the check report is
// stored with the revision. Every revision lives in `<out>/revisions/<id>/`
// (pointer, index, manifest, report); `<out>/current.json` names the one in
// use and `<out>/history.json` records each publication and rollback.
// Previews are content-addressed (`<out>/previews/<sha>.png`) and shared by
// revisions. The GLB URLs carry the file hash; a rollback is refused when a
// file of that revision has changed since: the reference server keeps one
// copy of each file, a production backend keeps every revision's files.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { formatCatalogReport } from '../../dist/configurator-3d.js'
import { runCatalogCheck } from './check.mjs'
import { buildIndex, parseArgs, sha256 } from './tools.mjs'
import { renderPreviews } from './previews.mjs'

const posix = (path) => path.split(sep).join('/')
const exists = (path) => access(path).then(() => true, () => false)
const readJson = async (path, fallback) => (await exists(path)) ? JSON.parse(await readFile(path, 'utf8')) : fallback
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

async function record(out, entry) {
  const history = await readJson(join(out, 'history.json'), [])
  history.push(entry)
  await writeJson(join(out, 'history.json'), history)
}

async function setCurrent(out, revision, report) {
  await writeJson(join(out, 'current.json'), {
    revision,
    index: `revisions/${revision}/index.json`,
    manifest: `revisions/${revision}/manifest.json`,
    report: `revisions/${revision}/report.json`,
    publishedAt: new Date().toISOString(),
    ...(report ? { summary: report.summary } : {}),
  })
}

export async function publishCatalog({ models = 'public/models', manifest = 'catalog/manifest.json', out = 'public/catalog', previews = true, log = console.log } = {}) {
  const { report, index: checkedIndex, manifest: parsed, scan } = await runCatalogCheck({ models, manifest })
  log(formatCatalogReport({ thresholds: {}, ...report }))
  if (report.blocking) return { published: false, report }
  const revision = checkedIndex.revision
  const dir = join(out, 'revisions', revision)
  await mkdir(dir, { recursive: true })
  await mkdir(join(out, 'previews'), { recursive: true })
  const previewFile = (asset) => join(out, 'previews', `${asset.sha256.slice(0, 16)}.png`)
  if (previews) {
    for (const { asset, png } of await renderPreviews(scan.assets.filter((asset) => !asset.vehicle), models, previewFile, exists)) {
      await writeFile(previewFile(asset), png)
      log(`anteprima ${asset.file}`)
    }
  }
  const fromDir = (path) => posix(relative(dir, path))
  const hasPreview = new Set()
  for (const asset of scan.assets) if (await exists(previewFile(asset))) hasPreview.add(asset.file)
  const index = buildIndex(revision, scan.assets,
    (asset) => `${fromDir(join(models, asset.file))}?v=${asset.sha256.slice(0, 16)}`,
    (asset) => hasPreview.has(asset.file) ? fromDir(previewFile(asset)) : undefined)
  await writeJson(join(dir, 'index.json'), index)
  await writeJson(join(dir, 'manifest.json'), parsed)
  await writeJson(join(dir, 'report.json'), report)
  await writeJson(join(dir, 'pointer.json'), { revision, index: 'index.json', manifest: 'manifest.json', report: 'report.json', publishedAt: index.createdAt })
  await setCurrent(out, revision, report)
  await record(out, { action: 'publish', revision, at: index.createdAt, summary: report.summary, manifestSha256: sha256(JSON.stringify(parsed)) })
  log(`Pubblicata la revisione ${revision}`)
  return { published: true, revision, report, index }
}

/** Point `current.json` back at a published revision whose files are all still the same. */
export async function rollbackCatalog({ revision, models = 'public/models', out = 'public/catalog', log = console.log }) {
  const dir = join(out, 'revisions', revision)
  if (!await exists(join(dir, 'index.json'))) throw new Error(`Revisione ${revision} non pubblicata`)
  const index = await readJson(join(dir, 'index.json'))
  const changed = []
  for (const asset of [...index.products, ...index.enclosures]) {
    const path = join(models, asset.file)
    if (!await exists(path)) changed.push(`${asset.file} mancante`)
    else if (sha256(await readFile(path)) !== asset.sha256) changed.push(`${asset.file} modificato`)
  }
  if (changed.length) throw new Error(`Revisione ${revision} non ripristinabile: ${changed.join(', ')}`)
  const report = await readJson(join(dir, 'report.json'), null)
  await setCurrent(out, revision, report)
  await record(out, { action: 'rollback', revision, at: new Date().toISOString() })
  log(`Revisione corrente: ${revision}`)
  return { revision }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (args.rollback) await rollbackCatalog({ revision: args.rollback, models: args.models, out: args.out })
    else {
      const result = await publishCatalog({ models: args.models, manifest: args.manifest, out: args.out, previews: !args['no-previews'] })
      if (!result.published) { console.error('Revisione NON pubblicata: errori bloccanti.'); process.exit(1) }
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
