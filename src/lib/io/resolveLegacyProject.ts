import type { AssemblyManifest, ItemRule, ItemSnapPoint, ProjectData } from '../types'
import { inferLegacyConnections } from '../assembly/manifest'
import { reconcileConstraints } from '../state/projectGraph'

interface MetadataContext {
  assemblyManifest: AssemblyManifest | null
  itemSnaps: Record<string, ItemSnapPoint[]>
  itemRules: Record<string, ItemRule[]>
}

/** Resolve only a complete legacy graph. Missing metadata must never freeze a partial import. */
export function resolveLegacyProject(project: ProjectData | null, context: MetadataContext): ProjectData | null {
  if (!project || project.connections !== undefined || !context.assemblyManifest) return project
  if (project.items.some((item) => !Object.hasOwn(context.itemSnaps, item.catalogId) ||
    !Object.hasOwn(context.itemRules, item.catalogId))) return project
  const connections = inferLegacyConnections(project, context.assemblyManifest, context.itemSnaps, context.itemRules)
  const count = project.items.filter((item) => item.constraints?.some((constraint) => constraint.type === 'snapToItem')).length
  if (connections.length !== count) return project
  return { ...project, items: reconcileConstraints(project.items, connections), connections }
}
