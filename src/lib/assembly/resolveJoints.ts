import type { AssemblyManifest, ItemRule, ItemSnapPoint, ProjectData } from '../types'
import { resolveJoint } from './manifest'
import { isResolvedJoint, jointsOf, withJoints } from './graph'

interface MetadataContext {
  assemblyManifest: AssemblyManifest | null
  itemSnaps: Record<string, ItemSnapPoint[]>
  itemRules: Record<string, ItemRule[]>
}

/**
 * Upgrade every pending joint whose two products have hydrated. A joint whose
 * metadata is still missing, or whose connectors do not match, stays pending
 * as it was: it is never dropped, and never frozen by the joints around it.
 * Returns the same reference when nothing changes.
 */
export function resolvePendingJoints(project: ProjectData | null, context: MetadataContext): ProjectData | null {
  const manifest = context.assemblyManifest
  if (!project || !manifest) return project
  const byId = new Map(project.items.map((item) => [item.id, item]))
  const hydrated = (catalogId: string) => Object.hasOwn(context.itemSnaps, catalogId) && Object.hasOwn(context.itemRules, catalogId)
  let changed = false
  const joints = jointsOf(project).map((joint) => {
    if (isResolvedJoint(joint)) return joint
    const source = byId.get(joint.sourceItemId)
    const target = byId.get(joint.targetItemId)
    if (!source || !target || !hydrated(source.catalogId) || !hydrated(target.catalogId)) return joint
    const resolved = resolveJoint(joint, source, target, manifest, context.itemSnaps, context.itemRules)
    if (resolved) changed = true
    return resolved ?? joint
  })
  return changed ? withJoints(project, project.items, joints) : project
}
