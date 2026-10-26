import { nanoid } from 'nanoid'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { useSceneTools } from '../scene/useSceneTools'
import { computePartnerPlacement, MIRROR_PAIR_RULE, mirrorPairConstraint, mirrorPairDistances, pairDistanceForSpan } from '../scene/mirrorPair'
import { assemblyGroup, assemblyPosePatches, canMate, dedupeJoints, jointsSurvivingMove, rotateGroupPatches } from '../scene/mating'
import { connectionsAtPose, definitionFor } from '../assembly/manifest'
import { attachmentPoints, beginAttachment } from '../scene/attachment'
import { Icon } from './Icon'
import type { Connection, ItemSnapPoint, PlacedItem } from '../types'

interface Props { readOnly?: boolean }

function certifiedPoints(
  points: ItemSnapPoint[],
  declared: ItemSnapPoint[] | undefined,
): ItemSnapPoint[] {
  if (!declared?.length) return points
  const ids = new Set(declared.map((p) => p.id))
  const kinds = new Set(declared.map((p) => p.kind))
  return points.filter((p) => ids.has(p.id) || !kinds.has(p.kind))
}

export function Inspector({ readOnly: hostReadOnly }: Props) {
  const storeApi = useConfiguratorStoreApi()
  const { getItem, colliderSizeOf } = useSceneTools()
  const state = useConfiguratorStore((value) => value)
  const { project, catalog, itemRules, itemSnaps, assemblyManifest, selectedId,
    updateItem, updateItems, commitAssembly, createMirrorPair, removeMirrorPair, removeItem, select } = state
  const item = project?.items.find((entry) => entry.id === selectedId)
  if (!item || state.attachment) return null
  const members = assemblyGroup(item.id, project!.items, project!.connections ?? [])
  const readOnly = hostReadOnly || state.readOnly || !!project?.items.some((member) => members.has(member.id) && (member.locked || member.constraints?.some((constraint) => constraint.type === 'lockAxis')))
  const cat = catalog[item.catalogId]
  const [x, y, z] = item.position
  const size = state.itemSizes[item.catalogId] ?? cat?.size
  const anchors = state.getEffectiveAnchors()
  const snapTarget = item.constraints?.find((constraint) => constraint.type === 'snapToAnchor')?.target
  const joints = (project?.connections ?? []).filter((joint) => joint.sourceItemId === item.id || joint.targetItemId === item.id)
  const canAttach = attachmentPoints(state, item.id).length > 0
  const pairRule = itemRules[item.catalogId]?.find((r) => r.rule === MIRROR_PAIR_RULE)
  const pairDistances = pairRule ? mirrorPairDistances(pairRule) : []
  const pair = mirrorPairConstraint(item)

  // Spacings that actually take a horizontal, worked out from the parts
  // themselves: a part seats when the gap equals its end-to-end span minus the
  // insertion margin at each end. The GLB's own list is offered too, but on
  // this catalogue none of its spacings seats anything — pick one and the
  // horizontal stops short of both uprights.
  const myConnectors = definitionFor(assemblyManifest, item.catalogId)?.connectors ?? []
  const matesWithMe = (catalogId: string) =>
    (definitionFor(assemblyManifest, catalogId)?.connectors ?? []).some((theirs) =>
      myConnectors.some(
        (mine) =>
          (theirs.compatibleWith?.includes(mine.id) ?? false) ||
          (mine.compatibleWith?.includes(theirs.id) ?? false),
      ),
    )

  // Only the seats the catalogue declares: a perforated upright also carries
  // dozens of generated hole centres, and pairing those off would be noise.
  const pairSeats = cat?.snapPoints ?? []
  const seating = new Map<number, string[]>()
  if (pairRule) {
    for (const part of Object.values(catalog)) {
      if (part.id === item.catalogId || !matesWithMe(part.id)) continue
      const points = certifiedPoints(itemSnaps[part.id] ?? part.snapPoints ?? [], part.snapPoints)
      for (const seat of pairSeats) {
        for (const a of points) {
          for (const b of points) {
            if (a === b || !canMate(seat.kind, a.kind) || !canMate(seat.kind, b.kind)) continue
            const span = Math.hypot(
              a.position[0] - b.position[0],
              a.position[1] - b.position[1],
              a.position[2] - b.position[2],
            )
            const key = Math.round(pairDistanceForSpan(pairRule, span, seat.position) * 1000) / 1000
            if (key <= 0) continue
            const labels = seating.get(key) ?? []
            if (!labels.includes(part.label)) seating.set(key, [...labels, part.label])
          }
        }
      }
    }
  }

  const offeredDistances = [...new Set([...pairDistances, ...seating.keys()])].sort((a, b) => a - b)
  const fitsAt = (distance: number) => {
    for (const [key, labels] of seating) {
      // 2 mm, the manifest's default snap tolerance.
      if (Math.abs(key - distance) <= 0.002) return labels
    }
    return []
  }

  const handleSnap = (anchorId: string | null) => {
    if (!anchorId) {
      updateItem(item.id, { constraints: item.constraints?.filter((constraint) => constraint.type !== 'snapToAnchor') })
      return
    }
    const anchor = anchors.find((candidate) => candidate.id === anchorId)
    const state = storeApi.getState()
    if (!anchor || !state.project) return
    const members = assemblyGroup(item.id, state.project.items, state.project.connections ?? [])
    const patches = assemblyPosePatches(state.project.items, members, item, { position: anchor.position, rotation: item.rotation })
      .map((entry) => entry.id === item.id ? { ...entry, patch: { ...entry.patch, constraints: [
        ...(item.constraints?.filter((constraint) => constraint.type !== 'snapToAnchor') ?? []),
        { type: 'snapToAnchor' as const, target: anchor.id },
      ] } } : entry)
    if (state.project.connections === undefined) updateItems(patches)
    else commitAssembly(patches, state.project.connections)
  }

  const connectionsAfterMove = (moved: PlacedItem[]): Connection[] => {
    const s = storeApi.getState()
    if (!s.project) return []
    const byId = new Map(moved.map((it) => [it.id, it]))
    // Joints that straddle the move are broken by it; the rest stand, and what
    // the moved parts touch now is recomputed from their new poses.
    const kept = jointsSurvivingMove(moved, s.project.connections ?? [])
    const context = {
      items: s.project.items.map((it) => byId.get(it.id) ?? it),
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules, itemSizes: s.itemSizes,
      manifest: assemblyManifest,
      // A twin that was only just created has no live group yet, so its
      // collider is not registered: the catalogue size is the same box.
      heightOf: (placed: PlacedItem) =>
        colliderSizeOf(placed.id)?.[1] ?? s.catalog[placed.catalogId]?.size?.[1] ?? 0,
    }
    return dedupeJoints([...kept, ...moved.flatMap((it) => connectionsAtPose(it, it, context))])
  }

  const handleUnjoin = () => {
    const s = storeApi.getState()
    const connections = (s.project?.connections ?? []).filter(
      (connection) => connection.sourceItemId !== item.id && connection.targetItemId !== item.id,
    )
    if (connections.length !== (s.project?.connections ?? []).length) {
      commitAssembly([{ id: item.id, patch: { constraints: item.constraints?.filter((c) => c.type !== 'snapToItem') } }], connections)
    } else {
      updateItem(item.id, { constraints: item.constraints?.filter((c) => c.type !== 'snapToItem') })
    }
  }

  const handleRotate = (step: number) => {
    const s = storeApi.getState()
    const items = s.project?.items ?? []
    const members = assemblyGroup(item.id, items, s.project?.connections ?? [])
    const patches = rotateGroupPatches(items, members, item.position, step)
    for (const patch of patches) {
      const reg = getItem(patch.id)
      const position = patch.patch.position
      const rotation = patch.patch.rotation
      if (!reg || !position || !rotation) continue
      reg.group.position.set(
        position[0],
        position[1] + (colliderSizeOf(patch.id)?.[1] ?? 0) / 2,
        position[2],
      )
      reg.group.rotation.set(rotation[0], rotation[1], rotation[2])
      reg.group.updateWorldMatrix(true, false)
    }
    // The group is closed under its joints, so turning all of it changes none
    // of them: every seat swings with the part it holds.
    updateItems(patches)
  }

  const handlePairDistance = (distance: number) => {
    if (!pairRule) return
    const placement = computePartnerPlacement(item, pairRule, distance)
    if (pair?.target) {
      // Already paired: move the partner and update the stored distance on both.
      const setDistance = (it: PlacedItem) =>
        it.constraints?.map((c) => (c.type === 'mirrorPair' ? { ...c, distance } : c))
      const partner = project?.items.find((it) => it.id === pair.target)
      if (!partner) return
      const patch = {
        position: placement.position,
        rotation: placement.rotation,
        constraints: setDistance(partner),
      }
      commitAssembly(
        [
          { id: item.id, patch: { constraints: setDistance(item) } },
          { id: partner.id, patch },
        ],
        connectionsAfterMove([{ ...partner, ...patch }]),
      )
    } else {
      const twin: PlacedItem = {
        id: nanoid(8),
        catalogId: item.catalogId,
        position: placement.position,
        rotation: placement.rotation,
        mirrored: placement.mirrored,
      }
      createMirrorPair(item.id, twin, distance, connectionsAfterMove([twin]))
    }
  }

  return (
    <section className="cfg-inspector" aria-label="Proprietà componente" style={{ width: 280, maxWidth: '100%', minHeight: 0, flexShrink: 1, overflow: 'hidden', pointerEvents: 'auto' }}>
      <div className="cfg-inspector-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div><span className="cfg-eyebrow">COMPONENTE SELEZIONATO</span><h3>{cat?.label ?? item.catalogId}</h3></div>
        <button className="cfg-icon-button" onClick={() => select(null)} aria-label="Deseleziona componente"><Icon name="close" size={16} /></button>
      </div>
      <div className="cfg-inspector-body">
        <button className="cfg-button cfg-primary" disabled={readOnly || !canAttach} onClick={() => beginAttachment(storeApi, item.id)} title={canAttach ? 'Scegli i punti di snap direttamente nella scena' : 'Nessun punto di snap disponibile'}><Icon name="link" size={16} />Aggancia nella scena<Icon name="arrow" size={15} /></button>
        <span className="cfg-property-label">Posizione · metri</span>
        <div className="cfg-coordinates">{[x, y, z].map((value, index) => <span key={index}><b>{['X', 'Y', 'Z'][index]}</b>{value.toFixed(3)}</span>)}</div>
        {size && <small style={{ display: 'block', color: 'var(--cfg-text-muted)', fontSize: 11, marginTop: 10 }}>Dimensioni {(size[0] * 100).toFixed(1)} × {(size[1] * 100).toFixed(1)} × {(size[2] * 100).toFixed(1)} cm</small>}
        <span className="cfg-property-label">Rotazione</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cfg-button" style={{ flex: 1 }} disabled={readOnly} onClick={() => handleRotate(-Math.PI / 2)} aria-label="Ruota di -90 gradi"><Icon name="rotate" size={16} />−90°</button>
          <button className="cfg-button" style={{ flex: 1 }} disabled={readOnly} onClick={() => handleRotate(Math.PI / 2)} aria-label="Ruota di +90 gradi"><Icon name="rotate" size={16} style={{ transform: 'scaleX(-1)' }} />+90°</button>
        </div>
        {joints.length > 0 && <details><summary>{joints.length} {joints.length === 1 ? 'aggancio' : 'agganci'} in questo componente</summary><p style={{ color: 'var(--cfg-text-muted)', lineHeight: 1.6 }}>Fa parte di un assieme di {members.size} componenti. Muovendolo, sposti l’assieme.</p><button className="cfg-button" disabled={readOnly} onClick={handleUnjoin}>Sgancia componente</button></details>}
        {offeredDistances.length > 0 && <details open={!!pair}><summary>Coppia specchiata {pair ? '· attiva' : ''}</summary><div className="cfg-pair-options">
          {offeredDistances.map((distance) => <button key={distance} disabled={readOnly} aria-pressed={pair?.distance === distance} onClick={() => handlePairDistance(distance)}><span>{formatCm(distance)} cm</span><span>{fitsAt(distance).join(' · ') || 'Distanza libera'}</span></button>)}
          {pair && <button disabled={readOnly} onClick={() => removeMirrorPair(item.id)}>Scollega coppia</button>}
        </div></details>}
        {anchors.length > 0 && <details><summary>Posizionamento nel vano</summary><select aria-label="Punto del vano" disabled={readOnly} value={snapTarget ?? ''} onChange={(event) => handleSnap(event.target.value || null)} style={{ width: '100%', background: 'var(--cfg-surface-muted)', color: 'var(--cfg-text-secondary)', border: '1px solid var(--cfg-line)', padding: 9, borderRadius: 8, marginTop: 10, fontSize: 12 }}><option value="">Posizione libera</option>{anchors.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.id}</option>)}</select></details>}
      </div>
      <div className="cfg-inspector-footer">
        <small style={{ color: 'var(--cfg-text-subtle)', fontSize: 11 }}>{readOnly ? 'Componente bloccato' : 'Tasto destro per le azioni'}</small>
        <button className="cfg-icon-button" disabled={readOnly} onClick={() => removeItem(item.id)} aria-label="Elimina componente" title="Elimina componente" style={{ color: 'var(--cfg-error)' }}><Icon name="trash" size={16} /></button>
      </div>
    </section>
  )
}

const formatCm = (metres: number) => (metres * 100).toFixed(1).replace(/\.0$/, '')
