import { useSceneTools } from './useSceneTools'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { type NeighborGap } from './neighborGap'

/**
 * Live product-to-product distance readout for the selected item: measures the
 * gap to the nearest other product on the nearest axis only (see
 * scene/neighborGap.ts) and draws it in the scene as a dimension bar + label.
 *
 * Mounted inside the Canvas. Recomputes every frame from the live Three.js
 * groups (so it tracks pointer drags and gizmo moves alike), but only writes to
 * the store when the quantized value changes — otherwise a stationary selection
 * would re-render the label on every frame.
 *
 * The bar is a scaled unit box, not a line: `lineBasicMaterial` ignores
 * linewidth on most platforms, and drei's <Line> rebuilds its LineGeometry +
 * LineMaterial every time `points` changes (i.e. constantly during a drag).
 */

/** Store-write granularity: 0.5 mm, well under the 1-decimal-cm readout. */
const QUANTUM = 0.0005
/** Cross-section of the dimension bar (m). */
const BAR_THICKNESS = 0.004

function sameGap(a: NeighborGap | null, b: NeighborGap | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.itemId === b.itemId &&
    a.otherId === b.otherId &&
    a.axis === b.axis &&
    a.distance === b.distance &&
    a.from[0] === b.from[0] &&
    a.from[1] === b.from[1] &&
    a.from[2] === b.from[2] &&
    a.to[0] === b.to[0] &&
    a.to[1] === b.to[1] &&
    a.to[2] === b.to[2]
  )
}

const quantize = (v: number) => Math.round(v / QUANTUM) * QUANTUM

function quantizeGap(g: NeighborGap): NeighborGap {
  return {
    ...g,
    distance: quantize(g.distance),
    from: [quantize(g.from[0]), quantize(g.from[1]), quantize(g.from[2])],
    to: [quantize(g.to[0]), quantize(g.to[1]), quantize(g.to[2])],
  }
}

export function NeighborGapIndicator() {
  const storeApi = useConfiguratorStoreApi()
  const { computeNeighborGap } = useSceneTools()
  const prevRef = useRef<NeighborGap | null>(null)

  useFrame(() => {
    const state = storeApi.getState()
    let next: NeighborGap | null = null
    if (!state.walkMode && state.selectedId) {
      const g = computeNeighborGap(state.selectedId)
      if (g) next = quantizeGap(g)
    }

    if (sameGap(prevRef.current, next)) return
    prevRef.current = next
    state.setNeighborGap(next)
  })

  return <NeighborGapLabel />
}

function NeighborGapLabel() {
  const gap = useConfiguratorStore((s) => s.neighborGap)
  if (!gap) return null

  const cm = gap.distance * 100
  // Same threshold feel as the wall-clearance panel: tight gaps read as warnings.
  const color = cm < 1 ? '#ffaa33' : '#00d5ff'
  const mid: [number, number, number] = [
    (gap.from[0] + gap.to[0]) / 2,
    (gap.from[1] + gap.to[1]) / 2,
    (gap.from[2] + gap.to[2]) / 2,
  ]
  // The measured axis is world-aligned, so the bar only needs a per-axis scale.
  const t = BAR_THICKNESS
  const scale: [number, number, number] =
    gap.axis === 'x'
      ? [Math.max(gap.distance, 1e-4), t, t]
      : gap.axis === 'y'
        ? [t, Math.max(gap.distance, 1e-4), t]
        : [t, t, Math.max(gap.distance, 1e-4)]

  return (
    <group>
      <mesh position={mid} scale={scale} renderOrder={1002}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
      </mesh>
      <Html position={mid} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(15,15,20,0.9)',
            border: `1px solid ${color}`,
            color,
            font: '600 11px/1.2 ui-monospace, monospace',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {gap.axis.toUpperCase()} {cm.toFixed(1)} cm
        </div>
      </Html>
    </group>
  )
}
