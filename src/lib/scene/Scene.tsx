import { Suspense, useId, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, Lightformer, GizmoHelper, GizmoViewport } from '@react-three/drei'
import type { ConfiguratorTheme, PlacedItem, ProjectData } from '../types'
import { sceneColors } from '../ui/theme'
import { AssetBoundary } from './AssetBoundary'
import { Enclosure } from './Enclosure'
import { ProductInstances } from './ProductInstances'
import { productAssetKey } from './productAsset'
import { AttachmentVisuals } from './AttachmentVisuals'
import { AnchorMarkers } from './AnchorMarkers'
import { SceneCaptureBridge } from './SceneCaptureBridge'
import { CameraPresetBridge } from './CameraPresetBridge'
import { IsometricCamera } from './IsometricCamera'
import { SelectedOrbitTarget } from './SelectedOrbitTarget'
import { NeighborGapIndicator } from './NeighborGapIndicator'
import { WalkControls } from './WalkControls'
import { PerformanceTelemetry } from './PerformanceTelemetry'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { selectEffectiveAnchors } from '../state/selectors'
import { own } from '../util/record'

interface Props {
  project: ProjectData
  environmentUrl?: string | null
  theme?: ConfiguratorTheme
}

export function Scene({ project, environmentUrl, theme = 'light' }: Props) {
  const colors = sceneColors[theme]
  // Scopes pointer lock to this canvas: several configurators may share the page.
  const canvasKey = useId()
  const storeApi = useConfiguratorStoreApi()
  const select = useConfiguratorStore((s) => s.select)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const effectiveAnchors = useConfiguratorStore(selectEffectiveAnchors)
  const draggingItemId = useConfiguratorStore((s) => s.draggingItemId)
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  const cameraProjection = useConfiguratorStore((s) => s.cameraProjection)
  const enclosureBBox = useConfiguratorStore((s) => s.enclosureBBox)

  // Grouped once per items array, so unchanged products keep their props and
  // their memoised instances skip re-rendering.
  const products = useMemo(() => {
    const byProduct = new Map<string, PlacedItem[]>()
    for (const item of project.items) byProduct.set(item.catalogId, [...(byProduct.get(item.catalogId) ?? []), item])
    return byProduct
  }, [project.items])

  // Pull-back limit: generous multiple of the enclosure size, with a floor so
  // small enclosures can still be framed from far out. Kept under the camera
  // `far` plane (150).
  const maxOrbitDistance = enclosureBBox
    ? Math.min(
        Math.max(
          Math.max(
            enclosureBBox.max[0] - enclosureBBox.min[0],
            enclosureBBox.max[1] - enclosureBBox.min[1], //X su Z
            enclosureBBox.max[2] - enclosureBBox.min[2], //Z su Y
          ) * 8,
          30,
        ),
        120,
      )
    : 60

  return (
    <Canvas
      data-cfg-canvas={canvasKey}
      camera={{ position: [5, 2.5, 5], fov: 45, near: 0.05, far: 150 }}
      onPointerMissed={() => { if (!storeApi.getState().attachment) select(null) }}
    >
      {cameraProjection === 'orthographic' && <IsometricCamera />}
      <SceneCaptureBridge />
      <CameraPresetBridge />
      <SelectedOrbitTarget />
      <NeighborGapIndicator />
      <PerformanceTelemetry />
      <color attach="background" args={[colors.background]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#f5f8ff', '#9aa9bd', 1.2]} />
      <directionalLight position={[5, 8, 5]} intensity={2.2} />
      <directionalLight position={[-5, 4, -5]} intensity={1.2} />

      {/* Each GLB-loading subtree gets its own Suspense boundary, so loading a
          new item type doesn't unmount the enclosure + already-placed items. */}
      <AssetBoundary id="enclosure" source={`${project.enclosure.glbUrl}:${project.enclosure.scale ?? 1}`}><Suspense fallback={null}>
        <Enclosure data={project.enclosure} />
      </Suspense></AssetBoundary>
      {[...products].map(([catalogId, items]) => {
        const product = own(catalog, catalogId)
        if (!product) return null
        return <AssetBoundary key={catalogId} id={`product:${catalogId}`} source={productAssetKey(product)}><Suspense fallback={null}>
          <ProductInstances catalog={product} items={items} anchors={effectiveAnchors} />
        </Suspense></AssetBoundary>
      })}
      {effectiveAnchors.length > 0 && <AnchorMarkers anchors={effectiveAnchors} />}
      <AttachmentVisuals />
      {/* Reflections and diffuse fill are separate from the visible background.
          Metallic materials need light from every direction, including inside
          the enclosure, rather than bright panels against a black environment. */}
      {environmentUrl && <AssetBoundary id="environment" source={environmentUrl}><Suspense fallback={null}>
        <Environment
          files={environmentUrl}
          resolution={256}
          environmentIntensity={1}
        />
      </Suspense></AssetBoundary>}
      {environmentUrl === undefined && (
        <Environment resolution={128} environmentIntensity={0.9}>
          <color attach="background" args={['#b8c2d0']} />
          <Lightformer intensity={3} position={[0, 8, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
          <Lightformer intensity={2} position={[8, 3, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 6, 1]} />
          <Lightformer intensity={2} position={[-8, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[10, 6, 1]} />
          <Lightformer intensity={1.5} position={[0, 3, 8]} rotation={[0, Math.PI, 0]} scale={[10, 6, 1]} />
          <Lightformer intensity={1.5} position={[0, 3, -8]} scale={[10, 6, 1]} />
        </Environment>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color={colors.background} />
      </mesh>
      <Grid
        position={[0, 0.003, 0]}
        args={[40, 40]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor={colors.cell}
        sectionSize={1}
        sectionThickness={1}
        sectionColor={colors.section}
        fadeDistance={12}
        fadeStrength={1.5}
      />

      <OrbitControls
        makeDefault
        enableDamping
        target={[0, 1, 0]}
        enabled={!walkMode && draggingItemId === null}
        maxPolarAngle={Math.PI / 2 - 0.05}
        // 12 cm — close enough to inspect a single 3 cm-thick panel, still
        // clear of the camera `near` plane (0.05).
        minDistance={0.12}
        maxDistance={maxOrbitDistance}
        minZoom={0.1}
        maxZoom={100}
        // Wider range needs fewer scroll ticks to cross it.
        zoomSpeed={1.4}
      />
      {walkMode && <WalkControls selector={`[data-cfg-canvas="${canvasKey}"]`} />}
      {!walkMode && (
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </Canvas>
  )
}
