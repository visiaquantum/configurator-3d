import { useMemo } from 'react'
import { useConfiguratorStoreApi } from '../state/store'
import * as registryTools from './itemRegistry'
import * as snapping from './snapping'
import { computeNeighborGap } from './neighborGap'

/** Bind the live scene operations components call to this configurator's registry. */
export function useSceneTools() {
  const store = useConfiguratorStoreApi()
  return useMemo(() => {
    const registry = store.getState().itemRegistry
    return {
      registerItem: (registration: registryTools.ItemRegistration) => registryTools.registerItem(registration, registry),
      unregisterItem: (id: string) => registryTools.unregisterItem(id, registry),
      clampItemToBounds: (id: string, bounds: snapping.CollisionBounds | null | undefined) => snapping.clampItemToBounds(id, bounds, registry),
      computeNeighborGap: (id: string, ignore?: ReadonlySet<string>) => computeNeighborGap(id, registry, ignore),
    }
  }, [store])
}
