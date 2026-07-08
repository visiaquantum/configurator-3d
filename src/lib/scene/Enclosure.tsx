import { useEffect, useRef } from 'react'
import { Box3, Color, DoubleSide, Mesh, MeshPhysicalMaterial, MathUtils } from 'three'
import type { Material, Object3D } from 'three'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
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
const FIAT_NDC40H2_URL_RE = /FIAT-NDC40H2\.glb$/i
const FIAT_FLOOR_SIZE: [number, number, number] = [3.45, 0.035, 1.82]
const FIAT_FLOOR_Y = 0.02
const FIAT_FLOOR_TOP_Y = FIAT_FLOOR_Y + FIAT_FLOOR_SIZE[1] / 2
const FIAT_FLOOR_ANCHORS = [
  {
    id: 'floor-back-side-a',
    position: [1.65, 0.04, -0.86] as [number, number, number],
    normal: [0, 1, 0] as [number, number, number],
  },
  {
    id: 'floor-back-side-b',
    position: [1.65, 0.04, 0.86] as [number, number, number],
    normal: [0, 1, 0] as [number, number, number],
  },
]

// Door rig: node-name → either a hinge rotation or a slide translation.
// Tuned empirically for the iveco.glb layout. Slide distances are in the
// node's local units (the iveco GLB uses cm internally, scaled 0.01 → m).
type DoorRig =
  | { kind: 'rotate'; axis: 'y' | 'z'; openAngle: number }
  | { kind: 'slide'; axis: 'x' | 'y' | 'z'; distance: number }
const DOOR_RIG: Record<string, DoorRig> = {
  Front_door_R: { kind: 'rotate', axis: 'y', openAngle: Math.PI / 2.2 },
  Front_door_L: { kind: 'rotate', axis: 'y', openAngle: -Math.PI / 2.2 },
  Back_door_1: { kind: 'rotate', axis: 'y', openAngle: -Math.PI / 1.5 },
  Back_door_2: { kind: 'rotate', axis: 'y', openAngle: Math.PI / 1.5 },
  Lateral_door: { kind: 'slide', axis: 'z', distance: -180 },
}

/**
 * Renders the enclosure GLB and extracts any embedded `anchor_*` nodes into
 * the configurator store. No physics — items are kinematic and overlap is
 * handled manually via AABB push-out, so floor/wall colliders aren't needed.
 */
export function Enclosure({ data }: Props) {
  const gltf = useGLTF(data.glbUrl)
  const needsFiatFloor = FIAT_NDC40H2_URL_RE.test(data.glbUrl)
  const setRuntimeAnchors = useConfiguratorStore((s) => s.setRuntimeAnchors)
  const setEnclosureBBox = useConfiguratorStore((s) => s.setEnclosureBBox)
  const setInteriorBBox = useConfiguratorStore((s) => s.setInteriorBBox)
  const xrayEnabled = useConfiguratorStore((s) => s.xrayEnabled)
  const doorsOpen = useConfiguratorStore((s) => s.doorsOpen)
  // All scene materials we mutate for xray (kept originals + freshly created
  // paint). Kept across renders so the xray effect can flip them in place.
  const materialsRef = useRef<Material[]>([])
  // Door nodes captured at scene-load and animated by the useFrame hook below.
  // basePos lets slide doors return to their original local position when closed.
  const doorsRef = useRef<
    { node: Object3D; rig: DoorRig; basePos: [number, number, number] }[]
  >([])
  const targetOpenRef = useRef(0)

  // Materials: if the GLB already ships its own materials (textured PBR, e.g.
  // the iveco model), keep them and only force DoubleSide. If it has none
  // (ACIS exports with no material chunk), replace every mesh material with
  // glossy paint so the interior walls render. Either way, every material is
  // collected for the xray toggle. Old paint mats we created are disposed.
  useEffect(() => {
    type GLTFParserLike = { json?: { materials?: unknown[] } }
    const parser = (gltf as unknown as { parser?: GLTFParserLike }).parser
    const hasGltfMaterials = !!parser?.json?.materials?.length

    const createdPaints: MeshPhysicalMaterial[] = []
    const kept = new Set<Material>()
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

    const swapToPaint = (m: Material): MeshPhysicalMaterial => {
      const cached = replaced.get(m)
      if (cached) return cached
      const next = makePaint()
      replaced.set(m, next)
      createdPaints.push(next)
      return next
    }

    gltf.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      if (!obj.geometry.attributes.normal) {
        obj.geometry.computeVertexNormals()
      }
      if (hasGltfMaterials) {
        const apply = (m: Material) => {
          m.side = DoubleSide
          m.needsUpdate = true
          kept.add(m)
          return m
        }
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map(apply)
        } else {
          obj.material = apply(obj.material)
        }
      } else if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(swapToPaint)
      } else {
        obj.material = swapToPaint(obj.material)
      }
    })

    materialsRef.current = hasGltfMaterials ? Array.from(kept) : createdPaints

    return () => {
      for (const p of createdPaints) p.dispose()
      materialsRef.current = []
    }
    // `gltf` is stable per URL (useGLTF caches it); we only need to re-run
    // when the loaded scene changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene])

  // Apply X-ray opacity reactively without recreating materials. The
  // immutability rule fires because we're mutating values reached through
  // a ref, but Three.js materials are intentionally mutable scene-graph
  // resources — that's the supported way to retune them at runtime.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    for (const m of materialsRef.current) {
      m.transparent = xrayEnabled
      m.opacity = xrayEnabled ? XRAY_OPACITY : 1
      m.depthWrite = !xrayEnabled
      m.needsUpdate = true
    }
  }, [xrayEnabled])
  /* eslint-enable react-hooks/immutability */

  // Find door nodes once per GLB load. They are animated via useFrame below.
  useEffect(() => {
    const found: { node: Object3D; rig: DoorRig; basePos: [number, number, number] }[] = []
    gltf.scene.traverse((obj) => {
      const rig = DOOR_RIG[obj.name]
      if (rig) {
        found.push({
          node: obj,
          rig,
          basePos: [obj.position.x, obj.position.y, obj.position.z],
        })
      }
    })
    doorsRef.current = found
  }, [gltf.scene])

  // Apply the optional scale to the loaded GLB, then lift it so the lowest
  // point sits on Y=0 — many vehicle GLBs are modeled with the body origin
  // at floor level, leaving the wheels below ground. Mutates the cached
  // scene, which is fine here because the enclosure is loaded once per URL.
  //
  // Anchor extraction (nodes named `anchor_*` or with `extras.kind ===
  // 'anchor'`) happens HERE, after scale + lift, so the anchor world
  // positions include both. Marker nodes are hidden after extraction.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const s = data.scale ?? 1
    gltf.scene.scale.setScalar(s)
    gltf.scene.position.y = 0
    gltf.scene.updateMatrixWorld(true)
    const probe = new Box3().setFromObject(gltf.scene)
    if (isFinite(probe.min.y)) {
      gltf.scene.position.y = -probe.min.y
      gltf.scene.updateMatrixWorld(true)
    }
    // Extract (and hide) GLB anchor markers. For the FIAT demo van the GLB
    // anchors are unusable (authored 20 cm above the floor), so only the two
    // hardcoded floor anchors are exposed.
    const anchors = hydrateAnchorsAndHide(gltf.scene)
    const active = needsFiatFloor ? FIAT_FLOOR_ANCHORS : anchors
    if (active.length > 0) setRuntimeAnchors(active)
  }, [gltf.scene, data.scale, needsFiatFloor, setRuntimeAnchors])
  /* eslint-enable react-hooks/immutability */

  // Compute and publish enclosure world-space AABB once per GLB. Also tries
  // to locate `Body_interior` and publish its bbox as the inner cargo area.
  // When the GLB ships no native anchors, synthesize a handful on the
  // interior floor so the demo can showcase snap-to-anchor behaviour.
  useEffect(() => {
    const box = new Box3().setFromObject(gltf.scene)
    setEnclosureBBox({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    })
    const interior = needsFiatFloor ? null : gltf.scene.getObjectByName('Body_interior')
    if (needsFiatFloor) {
      // The FIAT GLB does not expose a Body_interior node. Use the visible
      // cargo floor footprint plus the vehicle top to create a conservative
      // inner collision box: products stay above the wooden floor and inside
      // the van outline instead of clipping through the body mesh.
      setInteriorBBox({
        min: [-FIAT_FLOOR_SIZE[0] / 2, FIAT_FLOOR_TOP_Y, -FIAT_FLOOR_SIZE[2] / 2],
        max: [FIAT_FLOOR_SIZE[0] / 2, box.max.y, FIAT_FLOOR_SIZE[2] / 2],
      })
    } else if (interior) {
      const ibox = new Box3().setFromObject(interior)
      setInteriorBBox({
        min: [ibox.min.x, ibox.min.y, ibox.min.z],
        max: [ibox.max.x, ibox.max.y, ibox.max.z],
      })
      const existing = useConfiguratorStore.getState().runtimeAnchors
      if (existing.length === 0) {
        const inset = 0.15
        const wallInset = 0.05
        const xL = ibox.min.x + inset
        const xR = ibox.max.x - inset
        const zF = ibox.max.z - inset
        const zB = ibox.min.z + inset
        const cx = (ibox.min.x + ibox.max.x) / 2
        const cz = (ibox.min.z + ibox.max.z) / 2
        const fy = ibox.min.y
        // Wall anchors: stand-off from the wall by `wallInset` so a snapped
        // item sits flush against the wall instead of clipping through it.
        const xWallL = ibox.min.x + wallInset
        const xWallR = ibox.max.x - wallInset
        const zWallB = ibox.min.z + wallInset
        const yMid = (ibox.min.y + ibox.max.y) / 2
        const yHigh = ibox.min.y + (ibox.max.y - ibox.min.y) * 0.75
        const zFrontMid = (ibox.max.z + cz) / 2
        const zBackMid = (ibox.min.z + cz) / 2
        setRuntimeAnchors([
          // Floor
          { id: 'floor-front-left', position: [xL, fy, zF], normal: [0, 1, 0] },
          { id: 'floor-front-right', position: [xR, fy, zF], normal: [0, 1, 0] },
          { id: 'floor-back-left', position: [xL, fy, zB], normal: [0, 1, 0] },
          { id: 'floor-back-right', position: [xR, fy, zB], normal: [0, 1, 0] },
          { id: 'floor-center', position: [cx, fy, cz], normal: [0, 1, 0] },
          // Left wall — normal points into the cabin (+X)
          { id: 'wall-left-front-mid', position: [xWallL, yMid, zFrontMid], normal: [1, 0, 0] },
          { id: 'wall-left-center-mid', position: [xWallL, yMid, cz], normal: [1, 0, 0] },
          { id: 'wall-left-back-mid', position: [xWallL, yMid, zBackMid], normal: [1, 0, 0] },
          { id: 'wall-left-center-high', position: [xWallL, yHigh, cz], normal: [1, 0, 0] },
          // Right wall — normal points into the cabin (-X)
          { id: 'wall-right-front-mid', position: [xWallR, yMid, zFrontMid], normal: [-1, 0, 0] },
          { id: 'wall-right-center-mid', position: [xWallR, yMid, cz], normal: [-1, 0, 0] },
          { id: 'wall-right-back-mid', position: [xWallR, yMid, zBackMid], normal: [-1, 0, 0] },
          { id: 'wall-right-center-high', position: [xWallR, yHigh, cz], normal: [-1, 0, 0] },
          // Back wall — normal points forward (+Z)
          { id: 'wall-back-left-mid', position: [(xL + cx) / 2, yMid, zWallB], normal: [0, 0, 1] },
          { id: 'wall-back-right-mid', position: [(xR + cx) / 2, yMid, zWallB], normal: [0, 0, 1] },
        ])
      }
    } else {
      setInteriorBBox(null)
    }
    return () => {
      setEnclosureBBox(null)
      setInteriorBBox(null)
    }
  }, [gltf.scene, data.scale, needsFiatFloor, setEnclosureBBox, setInteriorBBox, setRuntimeAnchors])

  // Target tracks `doorsOpen` as 0/1; the useFrame loop lerps the actual
  // rotation toward it so the swing is smooth and reversible mid-animation.
  useEffect(() => {
    targetOpenRef.current = doorsOpen ? 1 : 0
  }, [doorsOpen])

  // Three.js scene-graph nodes are intentionally mutable; useFrame is the
  // supported way to drive per-frame transforms.
  /* eslint-disable react-hooks/immutability */
  useFrame((_, dt) => {
    const doors = doorsRef.current
    if (doors.length === 0) return
    // Critically damped-ish lerp. dt is seconds; rate chosen for ~0.5s travel.
    const rate = Math.min(1, dt * 5)
    const t = targetOpenRef.current
    for (const { node, rig, basePos } of doors) {
      if (rig.kind === 'rotate') {
        const current = rig.axis === 'y' ? node.rotation.y : node.rotation.z
        const target = t * rig.openAngle
        const next = MathUtils.lerp(current, target, rate)
        if (rig.axis === 'y') node.rotation.y = next
        else node.rotation.z = next
      } else {
        const axisIdx = rig.axis === 'x' ? 0 : rig.axis === 'y' ? 1 : 2
        const base = basePos[axisIdx]
        const target = base + t * rig.distance
        const current =
          rig.axis === 'x' ? node.position.x : rig.axis === 'y' ? node.position.y : node.position.z
        const next = MathUtils.lerp(current, target, rate)
        if (rig.axis === 'x') node.position.x = next
        else if (rig.axis === 'y') node.position.y = next
        else node.position.z = next
      }
    }
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <group userData={{ exportable: true }}>
      <primitive object={gltf.scene} />
      {needsFiatFloor && <FiatNdc40H2Floor xrayEnabled={xrayEnabled} />}
    </group>
  )
}

function FiatNdc40H2Floor({ xrayEnabled }: { xrayEnabled: boolean }) {
  return (
    <mesh position={[0, FIAT_FLOOR_Y, 0]} receiveShadow>
      <boxGeometry args={FIAT_FLOOR_SIZE} />
      <meshPhysicalMaterial
        color="#6f7378"
        metalness={0.15}
        roughness={0.55}
        clearcoat={0.35}
        transparent={xrayEnabled}
        opacity={xrayEnabled ? XRAY_OPACITY : 1}
        depthWrite={!xrayEnabled}
      />
    </mesh>
  )
}
