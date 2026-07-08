import type { Anchor } from '../types'
import { useConfiguratorStore } from '../state/store'

interface Props {
  anchors: Anchor[]
}

const CORE_RADIUS = 0.012
const HALO_RADIUS = 0.028
const RING_RADIUS_INNER = 0.032
const RING_RADIUS_OUTER = 0.04

export function AnchorMarkers({ anchors }: Props) {
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const updateItem = useConfiguratorStore((s) => s.updateItem)

  const selectedItem = project?.items.find((it) => it.id === selectedId)
  const activeAnchorId = selectedItem?.constraints?.find((c) => c.type === 'snapToAnchor')?.target

  return (
    <>
      {anchors.map((a) => {
        const isActive = activeAnchorId === a.id
        const color = isActive ? '#33ff88' : selectedItem ? '#3aa0ff' : '#ffaa22'
        const coreOpacity = selectedItem ? 1 : 0.85
        const haloOpacity = selectedItem ? 0.35 : 0.25

        return (
          <group key={a.id} position={a.position}>
            <mesh
              renderOrder={999}
              onPointerDown={(e) => {
                if (!selectedItem || isActive) return
                e.stopPropagation()
                updateItem(selectedItem.id, {
                  position: a.position,
                  constraints: [{ type: 'snapToAnchor', target: a.id }],
                })
              }}
            >
              <sphereGeometry args={[CORE_RADIUS, 16, 16]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={coreOpacity}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>

            <mesh renderOrder={998}>
              <sphereGeometry args={[HALO_RADIUS, 16, 16]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={haloOpacity}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>

            <mesh renderOrder={1000} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[RING_RADIUS_INNER, RING_RADIUS_OUTER, 32]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isActive ? 1 : 0.7}
                depthTest={false}
                toneMapped={false}
                side={2}
              />
            </mesh>
          </group>
        )
      })}
    </>
  )
}
