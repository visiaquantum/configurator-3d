import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei'
import type { ProjectData } from '../types'
import { Enclosure } from './Enclosure'
import { Item } from './Item'
import { AnchorMarkers } from './AnchorMarkers'
import { SceneCaptureBridge } from './SceneCaptureBridge'
import { CameraPresetBridge } from './CameraPresetBridge'
import { OverlapDetector } from './OverlapDetector'
import { WalkControls } from './WalkControls'
import { useConfiguratorStore } from '../state/store'

interface Props {
  project: ProjectData
}

export function Scene({ project }: Props) {
  const select = useConfiguratorStore((s) => s.select)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const runtimeAnchors = useConfiguratorStore((s) => s.runtimeAnchors)
  const draggingItemId = useConfiguratorStore((s) => s.draggingItemId)
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  const enclosureBBox = useConfiguratorStore((s) => s.enclosureBBox)
  const effectiveAnchors =
    runtimeAnchors.length > 0 ? runtimeAnchors : project.enclosure.anchors ?? []

  const maxOrbitDistance = enclosureBBox
    ? Math.max(
        enclosureBBox.max[0] - enclosureBBox.min[0],
        enclosureBBox.max[1] - enclosureBBox.min[1],
        enclosureBBox.max[2] - enclosureBBox.min[2],
      ) * 1.6
    : 15

  return (
    <Canvas
      camera={{ position: [5, 2.5, 5], fov: 45, near: 0.05, far: 150 }}
      shadows
      onPointerMissed={() => select(null)}
    >
      <SceneCaptureBridge />
      <CameraPresetBridge />
      <OverlapDetector />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />

      {/* Each GLB-loading subtree gets its own Suspense boundary, so loading a
          new item type doesn't unmount the enclosure + already-placed items. */}
      <Suspense fallback={null}>
        <Enclosure data={project.enclosure} />
      </Suspense>
      {project.items.map((it) => (
        <Suspense key={it.id} fallback={null}>
          <Item
            item={it}
            catalog={catalog[it.catalogId]}
            anchors={effectiveAnchors}
          />
        </Suspense>
      ))}
      {effectiveAnchors.length > 0 && <AnchorMarkers anchors={effectiveAnchors} />}
      {/* 4K workshop HDR: reflections + skybox + ground projection so the
          floor pixels from the HDR map onto a real plane at world Y=0.
          - height: photographer's eye height when the HDR was captured
            (~1.5 m for most Poly Haven indoor HDRs). This aligns the HDR
            horizon line with the world horizon.
          - radius: how far the floor projection extends before merging with
            the sphere. Matched to the HDR's visible interior radius.
          - scale: outer sphere radius (walls/ceiling distance). */}
      <Suspense fallback={null}>
        <Environment
          files="/hdr/empty_warehouse_01_4k.hdr"
          background
          resolution={2048}
          ground={{ height: 1.5, radius: 5, scale: 20 }}
          backgroundBlurriness={0}
          backgroundIntensity={1}
          environmentIntensity={1}
        />
      </Suspense>

      <Grid
        args={[20, 20]}
        cellSize={0.1}
        cellThickness={0.5}
        sectionSize={1}
        sectionThickness={1}
        fadeDistance={10}
        infiniteGrid
      />

      <OrbitControls
        makeDefault
        enableDamping
        target={[0, 1, 0]}
        enabled={!walkMode && draggingItemId === null}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={2}
        maxDistance={maxOrbitDistance}
      />
      {walkMode && <WalkControls />}
      {!walkMode && (
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </Canvas>
  )
}
