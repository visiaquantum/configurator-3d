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
 * When an item is selected, make OrbitControls rotate around that item's
 * collider center instead of the fixed scene/enclosure center.
 */
export function SelectedOrbitTarget() {
  const { controls, invalidate } = useThree() as {
    controls: unknown
    invalidate: () => void
  }
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const draggingItemId = useConfiguratorStore((s) => s.draggingItemId)
  const walkMode = useConfiguratorStore((s) => s.walkMode)

  useEffect(() => {
    if (walkMode || draggingItemId || !selectedId || !project || !isOrbitLike(controls)) return
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
  }, [selectedId, project, catalog, controls, invalidate, draggingItemId, walkMode])

  return null
}
