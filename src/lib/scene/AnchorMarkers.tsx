import type { Anchor } from '../types'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { selectCanMove } from '../state/selectors'
import { snapAssemblyToAnchor } from './commands'
import { chooseAttachmentAnchor } from './attachment'

/** Pointer travel (px) above which a press over a marker was an orbit, not a click. */
const CLICK_SLOP_PX = 4

interface Props {
  anchors: Anchor[]
}

const CORE_RADIUS = 0.012
const HALO_RADIUS = 0.028
const RING_RADIUS_INNER = 0.032
const RING_RADIUS_OUTER = 0.04
/** Markers grow while the guided attachment asks for one: they are the only thing to pick. */
const PICK_SCALE = 2.5

export function AnchorMarkers({ anchors }: Props) {
  const storeApi = useConfiguratorStoreApi()
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const canMove = useConfiguratorStore((s) => !!s.selectedId && selectCanMove(s, s.selectedId))

  // One primitive each: a pointer move elsewhere in the attachment must not re-render the markers.
  const attaching = useConfiguratorStore((s) => !!s.attachment)
  const picking = useConfiguratorStore((s) => s.attachment?.stage === 'anchor')
  const chosenId = useConfiguratorStore((s) => s.attachment?.stage === 'anchor' ? s.attachment.anchorId : undefined)
  const hoveredId = useConfiguratorStore((s) => s.attachment?.stage === 'anchor' ? s.attachment.hoveredAnchorId : undefined)

  const selectedItem = project?.items.find((it) => it.id === selectedId)
  const activeAnchorId = picking ? chosenId : selectedItem?.constraints?.find((c) => c.type === 'snapToAnchor')?.target
  const hover = (id: string | undefined) => {
    const state = storeApi.getState()
    if (state.attachment?.stage === 'anchor' && state.attachment.hoveredAnchorId !== id) state.setAttachment({ ...state.attachment, hoveredAnchorId: id })
  }

  return (
    <>
      {anchors.map((a) => {
        const isActive = activeAnchorId === a.id
        const color = isActive ? '#33ff88' : picking && hoveredId === a.id ? '#ffffff' : selectedItem ? '#3aa0ff' : '#ffaa22'
        const coreOpacity = selectedItem ? 1 : 0.85
        const haloOpacity = selectedItem ? 0.35 : 0.25

        return (
          <group key={a.id} position={a.position} scale={picking ? PICK_SCALE : 1}>
            <mesh
              renderOrder={999}
              // The same command as the inspector: the whole assembly moves and
              // keeps its joints and mirror pair. A click, not a press, so an
              // orbit that starts over a marker never moves anything. During a
              // guided attachment the marker answers only its anchor stage.
              onClick={(e) => {
                if (e.delta > CLICK_SLOP_PX) return
                if (picking) {
                  e.stopPropagation()
                  chooseAttachmentAnchor(storeApi, a.id)
                  return
                }
                if (attaching || !selectedItem || isActive || !canMove) return
                e.stopPropagation()
                snapAssemblyToAnchor(storeApi, selectedItem.id, a.id)
              }}
              onPointerOver={picking ? (e) => { e.stopPropagation(); hover(a.id) } : undefined}
              onPointerOut={picking ? () => hover(undefined) : undefined}
            >
              <sphereGeometry args={[picking ? HALO_RADIUS : CORE_RADIUS, 16, 16]} />
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
