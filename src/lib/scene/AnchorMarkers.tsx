import type { Anchor } from '../types'
import { useConfiguratorStore } from '../state/store'

interface Props {
  anchors: Anchor[]
}

const RADIUS = 0.006

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
        return (
          <mesh
            key={a.id}
            position={a.position}
            onPointerDown={(e) => {
              if (!selectedItem) return
              e.stopPropagation()
              updateItem(selectedItem.id, {
                constraints: [{ type: 'snapToAnchor', target: a.id }],
              })
            }}
          >
            <sphereGeometry args={[RADIUS, 12, 12]} />
            <meshBasicMaterial
              color={isActive ? '#33ff88' : selectedItem ? '#3aa0ff' : '#666'}
              transparent
              opacity={selectedItem ? 0.9 : 0.4}
            />
          </mesh>
        )
      })}
    </>
  )
}
