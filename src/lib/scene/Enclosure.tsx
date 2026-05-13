import { useEffect } from 'react'
import { DoubleSide, Mesh } from 'three'
import type { Material } from 'three'
import { useGLTF } from '@react-three/drei'
import type { EnclosureData } from '../types'
import { hydrateAnchorsAndHide } from '../io/anchors'
import { useConfiguratorStore } from '../state/store'

interface Props {
  data: EnclosureData
}

/**
 * Renders the enclosure GLB and extracts any embedded `anchor_*` nodes into
 * the configurator store. No physics — items are kinematic and overlap is
 * handled manually via AABB push-out, so floor/wall colliders aren't needed.
 */
export function Enclosure({ data }: Props) {
  const gltf = useGLTF(data.glbUrl)
  const setRuntimeAnchors = useConfiguratorStore((s) => s.setRuntimeAnchors)

  // Force DoubleSide on enclosure materials so walls render when the camera is
  // inside the cabinet. ACIS tessellation gives outward-facing normals only,
  // so backface culling hides the interior view otherwise.
  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m) => {
        m.side = DoubleSide
        m.needsUpdate = true
      })
    })
  }, [gltf.scene])

  // Extract anchors embedded in the GLB (nodes named `anchor_*` or with
  // `extras.kind === 'anchor'`). Marker nodes are hidden after extraction.
  useEffect(() => {
    const anchors = hydrateAnchorsAndHide(gltf.scene)
    if (anchors.length > 0) setRuntimeAnchors(anchors)
  }, [gltf.scene, setRuntimeAnchors])

  return (
    <group userData={{ exportable: true }}>
      <primitive object={gltf.scene} />
    </group>
  )
}
