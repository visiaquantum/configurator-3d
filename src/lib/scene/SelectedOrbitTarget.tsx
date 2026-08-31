import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { Vector3 as Vec3Type } from 'three'
import { useConfiguratorStore } from '../state/store'

interface OrbitLike {
  target: Vec3Type
  update: () => void
}

function isOrbitLike(c: unknown): c is OrbitLike {
  return !!c && typeof c === 'object' && 'target' in c && 'update' in c
}

/**
 * Centers OrbitControls on the selected item's collider center — **on demand
 * only**. Selecting an item deliberately does not move the camera; the user
 * asks for it via the "Centra" button (`requestFocusSelected` in the store),
 * which bumps `focusSelectedRequest` and triggers the effect below.
 */
export function SelectedOrbitTarget() {
  const { controls, invalidate } = useThree() as {
    controls: unknown
    invalidate: () => void
  }
  const focusRequest = useConfiguratorStore((s) => s.focusSelectedRequest)
  const walkMode = useConfiguratorStore((s) => s.walkMode)

  useEffect(() => {
    if (focusRequest === 0 || walkMode || !isOrbitLike(controls)) return

    // Read once, untracked: the effect must run when the request counter
    // changes, not whenever the item moves.
    const { selectedId, project, catalog } = useConfiguratorStore.getState()
    if (!selectedId || !project) return
    const item = project.items.find((it) => it.id === selectedId)
    if (!item) return

    const cat = catalog[item.catalogId]
    const scale = cat?.scale ?? 1
    const height = cat?.size ? cat.size[1] * scale : 0

    controls.target.set(
      item.position[0],
      item.position[1] + height / 2,
      item.position[2],
    )
    controls.update()
    invalidate()
  }, [focusRequest, controls, invalidate, walkMode])

  return null
}
