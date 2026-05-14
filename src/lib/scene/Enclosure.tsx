import { useEffect, useRef } from 'react'
import { Box3, Color, DoubleSide, Mesh, MeshPhysicalMaterial } from 'three'
import type { Material } from 'three'
import { useGLTF } from '@react-three/drei'
import type { EnclosureData } from '../types'
import { hydrateAnchorsAndHide } from '../io/anchors'
import { useConfiguratorStore } from '../state/store'

interface Props {
  data: EnclosureData
}

// Glossy car-paint material. Reflects the Environment preset for realism.
const BODY_COLOR = '#b8babd'
const BODY_METALNESS = 0.5
const BODY_ROUGHNESS = 0.35
const BODY_CLEARCOAT = 0.9
const BODY_CLEARCOAT_ROUGHNESS = 0.05
const XRAY_OPACITY = 0.18

/**
 * Renders the enclosure GLB and extracts any embedded `anchor_*` nodes into
 * the configurator store. No physics — items are kinematic and overlap is
 * handled manually via AABB push-out, so floor/wall colliders aren't needed.
 */
export function Enclosure({ data }: Props) {
  const gltf = useGLTF(data.glbUrl)
  const setRuntimeAnchors = useConfiguratorStore((s) => s.setRuntimeAnchors)
  const setEnclosureBBox = useConfiguratorStore((s) => s.setEnclosureBBox)
  const xrayEnabled = useConfiguratorStore((s) => s.xrayEnabled)
  // Painted materials list, kept across renders so xray toggle mutates them in
  // place instead of recreating (which would dispose + reload textures).
  const paintedMatsRef = useRef<MeshPhysicalMaterial[]>([])

  // Replace every mesh material with glossy car-paint PBR. DoubleSide keeps
  // interior walls visible (ACIS tessellation emits outward normals only).
  // Old materials are disposed to avoid GPU leaks on hot reload.
  useEffect(() => {
    const replaced = new Map<Material, MeshPhysicalMaterial>()
    const makePaint = () =>
      new MeshPhysicalMaterial({
        color: new Color(BODY_COLOR),
        metalness: BODY_METALNESS,
        roughness: BODY_ROUGHNESS,
        clearcoat: BODY_CLEARCOAT,
        clearcoatRoughness: BODY_CLEARCOAT_ROUGHNESS,
        side: DoubleSide,
      })

    gltf.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const swap = (m: Material): MeshPhysicalMaterial => {
        const cached = replaced.get(m)
        if (cached) return cached
        const next = makePaint()
        replaced.set(m, next)
        return next
      }
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(swap)
      } else {
        obj.material = swap(obj.material)
      }
    })

    paintedMatsRef.current = Array.from(replaced.values())

    return () => {
      replaced.forEach((next, old) => {
        next.dispose()
        old.dispose()
      })
      paintedMatsRef.current = []
    }
  }, [gltf.scene])

  // Apply X-ray opacity reactively without recreating materials. The
  // immutability rule fires because we're mutating values reached through
  // a ref, but Three.js materials are intentionally mutable scene-graph
  // resources — that's the supported way to retune them at runtime.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    for (const m of paintedMatsRef.current) {
      m.transparent = xrayEnabled
      m.opacity = xrayEnabled ? XRAY_OPACITY : 1
      m.depthWrite = !xrayEnabled
      m.needsUpdate = true
    }
  }, [xrayEnabled])
  /* eslint-enable react-hooks/immutability */

  // Extract anchors embedded in the GLB (nodes named `anchor_*` or with
  // `extras.kind === 'anchor'`). Marker nodes are hidden after extraction.
  useEffect(() => {
    const anchors = hydrateAnchorsAndHide(gltf.scene)
    if (anchors.length > 0) setRuntimeAnchors(anchors)
  }, [gltf.scene, setRuntimeAnchors])

  // Apply the optional scale to the loaded GLB. Mutates the cached scene,
  // which is fine here because the enclosure is loaded once per URL.
  useEffect(() => {
    const s = data.scale ?? 1
    gltf.scene.scale.setScalar(s)
    gltf.scene.updateMatrixWorld(true)
  }, [gltf.scene, data.scale])

  // Compute and publish enclosure world-space AABB once per GLB. Recomputes
  // whenever the scale changes so the HUD reflects the rendered size.
  useEffect(() => {
    const box = new Box3().setFromObject(gltf.scene)
    setEnclosureBBox({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    })
    return () => setEnclosureBBox(null)
  }, [gltf.scene, data.scale, setEnclosureBBox])

  return (
    <group userData={{ exportable: true }}>
      <primitive object={gltf.scene} />
    </group>
  )
}
