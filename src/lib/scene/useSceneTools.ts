import { useMemo } from 'react'
import { useConfiguratorStoreApi } from '../state/store'
import * as registryTools from './itemRegistry'
import * as mating from './mating'
import * as snapping from './snapping'
import { computeNeighborGap } from './neighborGap'
import type { ItemSnapPoint, Vec3 } from '../types'

/** Bind live scene operations to the current configurator's registry. */
export function useSceneTools() {
  const store = useConfiguratorStoreApi()
  return useMemo(() => {
    const registry = store.getState().itemRegistry
    return {
      getItem: (id: string) => registryTools.getItem(id, registry),
      registerItem: (registration: registryTools.ItemRegistration) => registryTools.registerItem(registration, registry),
      unregisterItem: (id: string) => registryTools.unregisterItem(id, registry),
      colliderSizeOf: (id: string) => registryTools.colliderSizeOf(id, registry),
      worldSnapPosition: (id: string, point: Vec3) => mating.worldSnapPosition(id, point, registry),
      listMatingTargets: (id: string, kind: string, points: Map<string, ItemSnapPoint[]>, opts?: { all?: boolean }) => mating.listMatingTargets(id, kind, points, opts, registry),
      resolveSnappedChildren: (id: string, ctx: mating.AssemblyContext) => mating.resolveSnappedChildren(id, ctx, registry),
      clampItemToBounds: (id: string, bounds: snapping.CollisionBounds | null | undefined) => snapping.clampItemToBounds(id, bounds, registry),
      findNearestVertexSnap: (id: string, threshold?: number) => snapping.findNearestVertexSnap(id, threshold, registry),
      offsetForLockedCorners: (id: string, corner: number, other: string, otherCorner: number) => snapping.offsetForLockedCorners(id, corner, other, otherCorner, registry),
      pushOutOverlaps: (id: string, iterations?: number, ignore?: ReadonlySet<string>) => snapping.pushOutOverlaps(id, iterations, ignore, registry),
      computeNeighborGap: (id: string, range?: number) => computeNeighborGap(id, range, registry),
    }
  }, [store])
}
