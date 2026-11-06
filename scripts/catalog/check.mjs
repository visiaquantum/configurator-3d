// Catalogue check from the command line:
//   node scripts/catalog/check.mjs [--models public/models] [--manifest catalog/manifest.json] [--report out.json]
// Exits 1 when the revision has blocking errors. Needs `npm run build:lib`.
import { readFile, writeFile } from 'node:fs/promises'
import { checkCatalog, formatCatalogReport, parseAssemblyManifest, AssemblyManifestError } from '../../dist/configurator-3d.js'
import { buildIndex, parseArgs, revisionId, scanCatalogFolder } from './tools.mjs'

/** Check a folder and a manifest file; a manifest that does not parse is a blocking finding too. */
export async function runCatalogCheck({ models = 'public/models', manifest: manifestPath = 'catalog/manifest.json' } = {}) {
  let manifest
  try {
    manifest = parseAssemblyManifest(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    const issues = error instanceof AssemblyManifestError ? error.issues : [{ path: '$', message: error.message }]
    return {
      report: {
        revision: '—', checkedAt: new Date().toISOString(), blocking: true,
        summary: { products: 0, enclosures: 0, samples: 0, errors: issues.length, warnings: 0, confirmations: 0 },
        issues: issues.map((entry) => ({ severity: 'error', code: 'manifest-invalid', file: manifestPath, point: entry.path, message: entry.message, action: 'Correggere il manifest nei campi indicati.' })),
      },
    }
  }
  const scan = await scanCatalogFolder(models, manifest)
  const revision = revisionId(manifest, scan.assets)
  const index = buildIndex(revision, scan.assets, (asset) => asset.file)
  const report = checkCatalog({ index, manifest: { ...manifest, revision }, models: scan.models })
  return { report, index, manifest: { ...manifest, revision }, scan }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2))
  const { report } = await runCatalogCheck(args)
  console.log(formatCatalogReport({ thresholds: {}, ...report }))
  if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
  process.exit(report.blocking ? 1 : 0)
}
