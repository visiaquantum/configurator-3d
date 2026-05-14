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
 * Lives inside the Canvas. Watches `cameraPreset` in the store and, when set,
 * snaps the active camera + OrbitControls target to a view computed from the
 * enclosure AABB. Clears the request after applying.
 */
export function CameraPresetBridge() {
  const { camera, controls } = useThree() as {
    camera: { position: Vec3Type; lookAt: (x: number, y: number, z: number) => void }
    controls: unknown
  }
  const preset = useConfiguratorStore((s) => s.cameraPreset)
  const bbox = useConfiguratorStore((s) => s.enclosureBBox)
  const setCameraPreset = useConfiguratorStore((s) => s.setCameraPreset)

  useEffect(() => {
    if (!preset || !bbox) return
    const cx = (bbox.min[0] + bbox.max[0]) / 2
    const cy = (bbox.min[1] + bbox.max[1]) / 2
    const cz = (bbox.min[2] + bbox.max[2]) / 2
    const dx = bbox.max[0] - bbox.min[0]
    const dy = bbox.max[1] - bbox.min[1]
    const dz = bbox.max[2] - bbox.min[2]
    const span = Math.max(dx, dy, dz)
    const d = span * 1.6

    let pos: [number, number, number]
    switch (preset) {
      case 'top':
        pos = [cx, cy + d * 1.2, cz + 0.0001]
        break
      case 'front':
        pos = [cx, cy, cz + d]
        break
      case 'side':
        pos = [cx + d, cy, cz]
        break
      case 'iso':
      default:
        pos = [cx + d * 0.75, cy + d * 0.6, cz + d * 0.75]
        break
    }

    camera.position.set(pos[0], pos[1], pos[2])
    camera.lookAt(cx, cy, cz)
    if (isOrbitLike(controls)) {
      controls.target.set(cx, cy, cz)
      controls.update()
    }
    setCameraPreset(null)
  }, [preset, bbox, camera, controls, setCameraPreset])

  return null
}
