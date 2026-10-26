import { useEffect, useMemo } from 'react'
import { Mesh, MeshBasicMaterial } from 'three'
import { useConfiguratorStore } from '../state/store'
import { computeAttachmentPreview } from './attachment'

/** Ghosts never enter the item registry or mutate the live assembly. */
export function AttachmentVisuals() {
  const state = useConfiguratorStore((value) => value)
  const interaction = state.attachment
  const sourceId = interaction?.sourceItemId
  const sourcePoint = interaction?.sourcePointId
  const targetId = interaction?.targetItemId
  const targetPoint = interaction?.hoveredPointId
  const preview = useMemo(() => sourceId && sourcePoint && targetId && targetPoint && interaction?.stage === 'point'
    ? computeAttachmentPreview(state, sourceId, sourcePoint, targetId, targetPoint) : null,
  [state, sourceId, sourcePoint, targetId, targetPoint, interaction?.stage])
  const ghosts = useMemo(() => (preview?.patches ?? []).flatMap(({ id, patch }) => {
    const original = state.itemRegistry.get(id)?.group
    const item = state.project?.items.find((entry) => entry.id === id)
    if (!original || !item || !patch.position || !patch.rotation) return []
    const clone = original.clone(true)
    const material = new MeshBasicMaterial({ color: preview?.valid ? '#46e8bc' : '#ff677d', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })
    const helpers: Mesh[] = []
    clone.traverse((object) => {
      object.userData = { ...object.userData, exportable: false }
      if (object instanceof Mesh) {
        if (object.userData.configuratorHelper) helpers.push(object)
        else object.material = material
      }
    })
    helpers.forEach((helper) => helper.removeFromParent())
    clone.userData.configuratorHelper = true
    clone.position.set(patch.position[0], patch.position[1] + (state.itemSizes[item.catalogId]?.[1] ?? 0) / 2, patch.position[2])
    clone.rotation.set(...patch.rotation)
    return [{ id, clone, material }]
  }), [preview, state.itemRegistry, state.project, state.itemSizes])
  useEffect(() => () => ghosts.forEach((ghost) => ghost.material.dispose()), [ghosts])
  return <>{ghosts.map((ghost) => <primitive key={ghost.id} object={ghost.clone} dispose={null} />)}</>
}
