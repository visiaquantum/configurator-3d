import { loadAssemblyManifest, loadCatalog, parseProject } from 'configurator-3d'
import type { ProjectData } from 'configurator-3d'

// Vite's base also supports installation under a gestionale subdirectory.
export const assetUrl = (path: string) => new URL(
  path.replace(/^\//, ''),
  new URL(import.meta.env.BASE_URL, window.location.href),
).href

export async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(assetUrl(path), { signal })
  if (!response.ok) throw new Error(`Caricamento ${path}: HTTP ${response.status}`)
  return response.json()
}

export function resolveProjectAssets(project: ProjectData): ProjectData {
  return { ...project, enclosure: { ...project.enclosure, glbUrl: assetUrl(project.enclosure.glbUrl) } }
}

export async function loadExample(signal: AbortSignal) {
  const [rawCatalog, manifest, rawProject] = await Promise.all([
    loadCatalog(assetUrl('catalog/catalog.json'), signal),
    loadAssemblyManifest(assetUrl('catalog/assembly-manifest.json'), signal),
    fetchJson('catalog/project.json', signal),
  ])
  const catalog = rawCatalog.map((product) => ({ ...product, glbUrl: assetUrl(product.glbUrl) }))
  const { project } = parseProject(rawProject, { catalog })
  return { catalog, manifest, project: resolveProjectAssets(project) }
}

export type ExampleData = Awaited<ReturnType<typeof loadExample>>
