import { useEffect, useMemo } from 'react'
import { Mesh, MeshBasicMaterial } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore } from '../state/store'
import { selectAssemblyView } from '../state/selectors'
import { computeAttachmentPreview } from './attachment'
import { own } from '../util/record'

/** Ghosts never enter the item registry or mutate the live assembly. */
export function AttachmentVisuals() {
  const state = useConfiguratorStore(useShallow(selectAssemblyView))
  const interaction = state.attachment
  const sourceId = interaction?.sourceItemId
  const sourcePoint = interaction?.sourcePointId
  const targetId = interaction?.targetItemId
  const targetPoint = interaction?.hoveredPointId
  const preview = useMemo(() => sourceId && sourcePoint && targetId && targetPoint && interaction?.stage === 'point'
    ? computeAttachmentPreview(state, sourceId, sourcePoint, targetId, targetPoint) : null,
  [state, sourceId, sourcePoint, targetId, targetPoint, interaction?.stage])
  // Two ghost materials for the whole session, not one per hover change.
  const ghostMaterials = useMemo(() => ({
    valid: new MeshBasicMaterial({ color: '#46e8bc', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
    invalid: new MeshBasicMaterial({ color: '#ff677d', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
  }), [])
  useEffect(() => () => { ghostMaterials.valid.dispose(); ghostMaterials.invalid.dispose() }, [ghostMaterials])
  const ghosts = useMemo(() => (preview?.patches ?? []).flatMap(({ id, patch }) => {
    const original = state.itemRegistry.get(id)?.group
    const item = state.project?.items.find((entry) => entry.id === id)
    if (!original || !item || !patch.position || !patch.rotation) return []
    const clone = original.clone(true)
    const material = preview?.valid ? ghostMaterials.valid : ghostMaterials.invalid
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
    clone.position.set(patch.position[0], patch.position[1] + (own(state.itemSizes, item.catalogId)?.[1] ?? 0) / 2, patch.position[2])
    clone.rotation.set(...patch.rotation)
    return [{ id, clone }]
  }), [preview, state.itemRegistry, state.project, state.itemSizes, ghostMaterials])
  return <>{ghosts.map((ghost) => <primitive key={ghost.id} object={ghost.clone} dispose={null} />)}</>
}
