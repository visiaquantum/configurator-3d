import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei'
import type { ProjectData } from '../types'
import { Enclosure } from './Enclosure'
import { Item } from './Item'
import { AnchorMarkers } from './AnchorMarkers'
import { SceneCaptureBridge } from './SceneCaptureBridge'
import { useConfiguratorStore } from '../state/store'

interface Props {
  project: ProjectData
}

export function Scene({ project }: Props) {
  const select = useConfiguratorStore((s) => s.select)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const runtimeAnchors = useConfiguratorStore((s) => s.runtimeAnchors)
  const draggingItemId = useConfiguratorStore((s) => s.draggingItemId)
  const effectiveAnchors =
    runtimeAnchors.length > 0 ? runtimeAnchors : project.enclosure.anchors ?? []

  return (
    <Canvas
      camera={{ position: [0.6, 0.5, 0.6], fov: 50, near: 0.01, far: 100 }}
      shadows
      onPointerMissed={() => select(null)}
    >
      <SceneCaptureBridge />
      <color attach="background" args={['#1a1a1f']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />

      <Suspense fallback={null}>
        <Enclosure data={project.enclosure} />
        {project.items.map((it) => (
          <Item
            key={it.id}
            item={it}
            catalog={catalog[it.catalogId]}
            anchors={effectiveAnchors}
          />
        ))}
        {effectiveAnchors.length > 0 && <AnchorMarkers anchors={effectiveAnchors} />}
        <Environment preset="warehouse" />
      </Suspense>

      <Grid
        args={[2, 2]}
        cellSize={0.02}
        cellThickness={0.5}
        sectionSize={0.1}
        sectionThickness={1}
        fadeDistance={4}
        infiniteGrid
      />

      <OrbitControls
        makeDefault
        enableDamping
        target={[0, 0.1, 0]}
        enabled={draggingItemId === null}
      />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
