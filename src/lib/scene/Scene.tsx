import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei'
import type { ProjectData } from '../types'
import { Enclosure } from './Enclosure'
import { Item } from './Item'
import { AnchorMarkers } from './AnchorMarkers'
import { SceneCaptureBridge } from './SceneCaptureBridge'
import { CameraPresetBridge } from './CameraPresetBridge'
import { SelectedOrbitTarget } from './SelectedOrbitTarget'
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
      <SelectedOrbitTarget />
      <OverlapDetector />
      <color attach="background" args={['#101827']} />
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
      {/* Keep the HDR only for material reflections; the visible scene uses a
          plain background and a readable floor grid. */}
      <Suspense fallback={null}>
        <Environment
          files="/hdr/empty_warehouse_01_4k.hdr"
          resolution={2048}
          environmentIntensity={1}
        />
      </Suspense>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color="#111827" />
      </mesh>
      <Grid
        position={[0, 0.003, 0]}
        args={[40, 40]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#334155"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#64748b"
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
