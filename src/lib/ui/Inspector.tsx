import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useConfiguratorStore } from '../state/store'
import {
  computePartnerPlacement,
  MIRROR_PAIR_RULE,
  mirrorPairConstraint,
  mirrorPairDistances,
  pairDistanceForSpan,
  withSnapConstraint,
} from '../scene/mirrorPair'
import {
  assemblyContext,
  assemblyGroup,
  canMate,
  dedupeJoints,
  itemSnapConstraint,
  jointsSurvivingMove,
  itemSnapConstraintFor,
  positionForItemSnap,
  resolveSnappedChildren,
  rotateGroupPatches,
  snapKindLabel,
  snapPointLabel,
  snapsForItem,
  worldSnapPosition,
  yawToMate,
} from '../scene/mating'
import { colliderSizeOf, getItem } from '../scene/itemRegistry'
import { connectionsAtPose, connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import type { Connection, Euler, ItemSnapPoint, PlacedItem } from '../types'

interface Props {
  readOnly?: boolean
}

/** A seat this item could be attached to, and how far its point is from it. */
interface Seat {
  myPoint: ItemSnapPoint
  targetItem: PlacedItem
  point: ItemSnapPoint
  distance: number
}

/**
 * How close a seat has to be to read as "this is the joint I mean". Wide enough
 * to reach the next seat up or down — the montante's are 25 cm apart — so the
 * level is a choice between buttons rather than a matter of aiming.
 */
const NEARBY_SEAT_RANGE = 0.3

/**
 * The points worth offering for a product. Where the catalogue names points of
 * a kind, they are the certified interface for that kind and the GLB's own
 * markers of it are duplicates or leftovers: the montante carries one at its
 * foot, and a piano attached there lands on the floor. Kinds the catalogue says
 * nothing about — the drilled holes — keep their markers.
 */
function certifiedPoints(
  points: ItemSnapPoint[],
  declared: ItemSnapPoint[] | undefined,
): ItemSnapPoint[] {
  if (!declared?.length) return points
  const ids = new Set(declared.map((p) => p.id))
  const kinds = new Set(declared.map((p) => p.kind))
  return points.filter((p) => ids.has(p.id) || !kinds.has(p.kind))
}

/**
 * Points bucketed by mating family, in first-seen order. A perforated upright
 * carries 40 generated hole centres next to its 5 named points, so a flat list
 * would bury the ones a person actually looks for.
 */
function groupByKind(points: ItemSnapPoint[]): Array<[string, ItemSnapPoint[]]> {
  const byKind = new Map<string, ItemSnapPoint[]>()
  for (const p of points) {
    const bucket = byKind.get(p.kind)
    if (bucket) bucket.push(p)
    else byKind.set(p.kind, [p])
  }
  return [...byKind]
}

export function Inspector({ readOnly }: Props) {
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const removeItem = useConfiguratorStore((s) => s.removeItem)
  const updateItem = useConfiguratorStore((s) => s.updateItem)
  const updateItems = useConfiguratorStore((s) => s.updateItems)
  const commitAssembly = useConfiguratorStore((s) => s.commitAssembly)
  const createMirrorPair = useConfiguratorStore((s) => s.createMirrorPair)
  const removeMirrorPair = useConfiguratorStore((s) => s.removeMirrorPair)
  const select = useConfiguratorStore((s) => s.select)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const itemRules = useConfiguratorStore((s) => s.itemRules)

  const itemSnaps = useConfiguratorStore((s) => s.itemSnaps)
  const runtimeAnchors = useConfiguratorStore((s) => s.runtimeAnchors)
  const assemblyManifest = useConfiguratorStore((s) => s.assemblyManifest)
  const interiorBBox = useConfiguratorStore((s) => s.interiorBBox)

  // Explicit join picker: which of my points goes onto which point of which
  // other product. `null` means "not chosen yet"; both must be set to apply.
  const [myPointId, setMyPointId] = useState<string | null>(null)
  const [targetItemId, setTargetItemId] = useState<string | null>(null)
  const [targetPointId, setTargetPointId] = useState<string | null>(null)
  const [showAllTargets, setShowAllTargets] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const item = project?.items.find((it) => it.id === selectedId)

  // Points of the selected item, and of every candidate destination. Computed
  // before the early return so hook order stays stable across selections.
  const myPoints = useMemo<ItemSnapPoint[]>(
    () => (item ? snapsForItem(item, itemSnaps, itemRules) : []),
    [item, itemSnaps, itemRules],
  )
  const myPoint = myPointId ? myPoints.find((p) => p.id === myPointId) : undefined

  const targetItems = useMemo(
    () =>
      (project?.items ?? [])
        .filter((it) => it.id !== item?.id && getItem(it.id))
        .map((it) => ({ item: it, points: snapsForItem(it, itemSnaps, itemRules) }))
        .filter((e) => e.points.length > 0),
    [project?.items, item?.id, itemSnaps, itemRules],
  )

  const targetEntry = targetItems.find((e) => e.item.id === targetItemId)
  const targetPoints = (targetEntry?.points ?? []).filter(
    (p) => showAllTargets || !myPoint || canMate(myPoint.kind, p.kind),
  )

  if (!item) return null

  const cat = catalog[item.catalogId]
  const [x, y, z] = item.position
  const size = cat?.size
  const anchors =
    runtimeAnchors.length > 0 ? runtimeAnchors : project?.enclosure.anchors ?? []
  const snapTarget = item.constraints?.find((c) => c.type === 'snapToAnchor')?.target

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

  // Seats already within reach of one of this item's points. Carrying a piano
  // up to a montante is the natural gesture, and it leaves the two faces a
  // couple of centimetres apart — close enough to say which joint is meant, so
  // it is offered as one button instead of three pickers.
  const nearbySeats = (): Seat[] => {
    const myDefinition = definitionFor(assemblyManifest, item.catalogId)
    const out: Seat[] = []
    for (const mine of certifiedPoints(myPoints, cat?.snapPoints)) {
      const sourceConnector = connectorForSnap(myDefinition, mine)
      if (assemblyManifest && !sourceConnector) continue
      const from = worldSnapPosition(item.id, mine.position)
      if (!from) continue
      for (const entry of targetItems) {
        const theirDefinition = definitionFor(assemblyManifest, entry.item.catalogId)
        for (const point of certifiedPoints(entry.points, catalog[entry.item.catalogId]?.snapPoints)) {
          if (!canMate(mine.kind, point.kind)) continue
          const targetConnector = connectorForSnap(theirDefinition, point)
          if (
            assemblyManifest &&
            (!sourceConnector ||
              !targetConnector ||
              !connectorsCanMate(sourceConnector, mine, targetConnector, point))
          ) continue
          const to = worldSnapPosition(entry.item.id, point.position)
          if (!to) continue
          const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
          if (distance > NEARBY_SEAT_RANGE) continue
          out.push({ myPoint: mine, targetItem: entry.item, point, distance })
        }
      }
    }
    // One row per seat, reached by whichever of my points is nearest: two ends
    // of the same piano can both be in range, and six buttons for one joint is
    // not a choice. Two seats on the same montante are, so they stay.
    const bySeat = new Map<string, Seat>()
    for (const seat of out.sort((a, b) => a.distance - b.distance)) {
      const key = `${seat.targetItem.id}|${seat.point.id}`
      if (!bySeat.has(key)) bySeat.set(key, seat)
    }
    return [...bySeat.values()].slice(0, 6)
  }

  // Existing product-to-product join, resolved to readable labels.
  const joined = itemSnapConstraint(item)
  const joinedTarget = joined?.target
    ? project?.items.find((it) => it.id === joined.target)
    : undefined
  const joinedMyPoint = myPoints.find((p) => p.id === joined?.point)
  const joinedTargetPoint = joinedTarget
    ? snapsForItem(joinedTarget, itemSnaps, itemRules).find((p) => p.id === joined?.targetPoint)
    : undefined
  const joinedFromLabel = joinedMyPoint ? snapPointLabel(joinedMyPoint) : (joined?.point ?? '?')
  const joinedTargetLabel = joinedTarget
    ? `${catalog[joinedTarget.catalogId]?.label ?? joinedTarget.catalogId} · ${
        joinedTargetPoint ? snapPointLabel(joinedTargetPoint) : (joined?.targetPoint ?? '?')
      }`
    : (joined?.target ?? '?')

  const pointLabelOf = (points: ItemSnapPoint[], id: string) => {
    const point = points.find((p) => p.id === id)
    return point ? snapPointLabel(point) : id
  }

  // Every joint this part has, not only the one that carries it. A piano laid
  // across a mirrored pair is bolted at both ends — the panel showed the first
  // alone, so the second looked like it had never taken.
  const joints = (project?.connections ?? [])
    .filter((c) => c.sourceItemId === item.id || c.targetItemId === item.id)
    .map((c) => {
      const onMe = c.sourceItemId === item.id ? c.sourcePointId : c.targetPointId
      const otherId = c.sourceItemId === item.id ? c.targetItemId : c.sourceItemId
      const onThem = c.sourceItemId === item.id ? c.targetPointId : c.sourcePointId
      const other = project?.items.find((it) => it.id === otherId)
      const theirLabel = other
        ? `${catalog[other.catalogId]?.label ?? other.catalogId}${other.mirrored ? ' (specchiato)' : ''} · ${
            pointLabelOf(snapsForItem(other, itemSnaps, itemRules), onThem)
          }`
        : otherId
      return {
        key: `${otherId}|${onThem}`,
        label: `${pointLabelOf(myPoints, onMe)} → ${theirLabel}`,
      }
    })
  const jointedSeats = new Set(joints.map((j) => j.key))

  const handleSnap = (anchorId: string | null) => {
    updateItem(item.id, {
      constraints: withSnapConstraint(
        item,
        anchorId ? { type: 'snapToAnchor', target: anchorId } : null,
      ),
    })
  }

  /**
   * The connection list after the panel itself moves parts — a mirror twin
   * placed at a new spacing, a quarter turn. Only the drag and the explicit
   * join used to record joints, so a twin that landed on a shelf's free end
   * was seated but unconnected: validation then read the insertion overlap at
   * that seat as a collision and the whole pair went red.
   */
  const connectionsAfterMove = (moved: PlacedItem[]): Connection[] => {
    const s = useConfiguratorStore.getState()
    if (!s.project) return []
    const byId = new Map(moved.map((it) => [it.id, it]))
    // Joints that straddle the move are broken by it; the rest stand, and what
    // the moved parts touch now is recomputed from their new poses.
    const kept = jointsSurvivingMove(moved, s.project.connections ?? [])
    const context = {
      items: s.project.items.map((it) => byId.get(it.id) ?? it),
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules,
      manifest: assemblyManifest,
      // A twin that was only just created has no live group yet, so its
      // collider is not registered: the catalogue size is the same box.
      heightOf: (placed: PlacedItem) =>
        colliderSizeOf(placed.id)?.[1] ?? s.catalog[placed.catalogId]?.size?.[1] ?? 0,
    }
    return dedupeJoints([...kept, ...moved.flatMap((it) => connectionsAtPose(it, it, context))])
  }

  /**
   * Join this item to another product: move it so `myPointId` lands exactly on
   * the chosen point of the target, record the link, then drag along anything
   * already joined to this item.
   */
  const handleJoinToItem = (choice?: Seat) => {
    const sourcePoint = choice ? choice.myPoint : myPoint
    const toItemId = choice ? choice.targetItem.id : targetItemId
    const targetPoint = choice ? choice.point : targetEntry?.points.find((p) => p.id === targetPointId)
    if (!sourcePoint || !toItemId || !targetPoint) return
    const size = colliderSizeOf(item.id)
    if (!size) return
    const world = worldSnapPosition(toItemId, targetPoint.position)
    if (!world) return

    // Turn the item so its mating face presses against the target's, then
    // translate. Faces that point up or down cannot be aligned by yaw, so
    // there the item keeps its current rotation.
    const targetItem = choice ? choice.targetItem : targetEntry?.item
    if (!targetItem) return
    const yaw = yawToMate(sourcePoint.normal, targetPoint.normal, targetItem.rotation[1])
    const rotation: Euler =
      yaw === null ? item.rotation : [item.rotation[0], yaw, item.rotation[2]]

    const position = positionForItemSnap(sourcePoint.position, rotation[1], size[1], world)
    const link = itemSnapConstraintFor(toItemId, sourcePoint.id, targetPoint.id)
    const kept = item.constraints?.filter((c) => c.type === 'mirrorPair') ?? []
    const s = useConfiguratorStore.getState()
    const targetDefinition = definitionFor(assemblyManifest, targetItem.catalogId)
    const sourceConnector = connectorForSnap(definitionFor(assemblyManifest, item.catalogId), sourcePoint)
    const targetConnector = connectorForSnap(targetDefinition, targetPoint)
    if (assemblyManifest && (!sourceConnector || !targetConnector || !connectorsCanMate(sourceConnector, sourcePoint, targetConnector, targetPoint))) {
      setJoinError('Questi connettori non sono autorizzati dal manifest tecnico')
      return
    }
    const connection: Connection | null = sourceConnector && targetConnector
      ? {
          sourceItemId: item.id,
          sourceConnectorId: sourceConnector.id,
          sourcePointId: sourcePoint.id,
          targetItemId: toItemId,
          targetConnectorId: targetConnector.id,
          targetPointId: targetPoint.id,
          resolvedTransform: { position, rotation },
        }
      : null
    const joints = connection
      ? connectionsAtPose(item, { position, rotation }, {
          items: s.project?.items ?? [],
          itemSnaps: s.itemSnaps,
          itemRules: s.itemRules,
          manifest: assemblyManifest,
          heightOf: (placed) => colliderSizeOf(placed.id)?.[1] ?? 0,
        })
      : []
    const connections = connection
      ? [
          ...(s.project?.connections ?? []).filter((existing) => existing.sourceItemId !== item.id),
          ...(joints.length > 0 ? joints : [connection]),
        ]
      : s.project?.connections ?? []
    const preview = s.project
      ? {
          ...s.project,
          connections,
          items: s.project.items.map((placed) =>
            placed.id === item.id ? { ...placed, position, rotation, constraints: [...kept, link] } : placed,
          ),
        }
      : null
    const problems = validateConfiguration(preview, s.catalog, assemblyManifest, {
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules,
      enclosureBounds: interiorBBox,
    }).filter((candidate) => candidate.level === 'error' && candidate.itemIds.includes(item.id))
    // Sticking out of the van does not make the joint wrong, and refusing over
    // it makes whole assemblies impossible to build: a frame wider than the van
    // is half the width across, and only fits once it is turned along the
    // length — which cannot be done before the parts are joined. The panel
    // still reports it, and moving the assembly clears it. Interference is
    // different: no move fixes a joint that was never geometrically possible.
    const issue = problems.find((candidate) => candidate.code !== 'out-of-bounds')
    if (issue) {
      setJoinError(issue.message)
      return
    }

    // Only now move the live group. An invalid explicit join never makes the
    // scene graph drift away from the persisted project.
    const reg = getItem(item.id)
    if (reg) {
      reg.group.position.set(position[0], position[1] + size[1] / 2, position[2])
      reg.group.rotation.set(rotation[0], rotation[1], rotation[2])
      reg.group.updateWorldMatrix(true, false)
    }
    const patches = [
      { id: item.id, patch: { position, rotation, constraints: [...kept, link] } },
      ...(s.project
        ? resolveSnappedChildren(
            item.id,
            assemblyContext(s.project.items, s.itemSnaps, s.itemRules),
          )
        : []),
    ]
    if (connection) commitAssembly(patches, connections)
    else updateItems(patches)
    // The joint is made; anything left is the out-of-bounds note, kept on
    // screen so the move it asks for is not a surprise.
    setJoinError(problems[0]?.message ?? null)
  }

  /** Break the link but leave the item where it is. */
  const handleUnjoin = () => {
    const s = useConfiguratorStore.getState()
    const connections = (s.project?.connections ?? []).filter(
      (connection) => connection.sourceItemId !== item.id && connection.targetItemId !== item.id,
    )
    if (connections.length !== (s.project?.connections ?? []).length) {
      commitAssembly([{ id: item.id, patch: { constraints: item.constraints?.filter((c) => c.type !== 'snapToItem') } }], connections)
    } else {
      updateItem(item.id, { constraints: item.constraints?.filter((c) => c.type !== 'snapToItem') })
    }
    setJoinError(null)
  }

  /**
   * Quarter turn about Y, for the whole assembly. The gizmo snaps to 90° but
   * landing on it by dragging is fiddly, and a frame is often wider than the
   * van across and only fits along its length — so the turn is a prerequisite
   * for building anything long, not a convenience.
   *
   * The selected part is the pivot: it stays where it is and the rest swings
   * around it. Rigid, so every joint keeps the fit it had.
   */
  const handleRotate = (step: number) => {
    const s = useConfiguratorStore.getState()
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
    <div style={panelStyle}>
      <div style={headerStyle}>Selezionato</div>
      <div style={bodyStyle}>
        <div style={rowStyle}><span style={labelStyle}>id</span><span style={valueStyle}>{item.id}</span></div>
        <div style={rowStyle}><span style={labelStyle}>tipo</span><span style={valueStyle}>{cat?.label ?? item.catalogId}</span></div>
        <div style={rowStyle}><span style={labelStyle}>pos (m)</span><span style={valueStyle}>{x.toFixed(3)}, {y.toFixed(3)}, {z.toFixed(3)}</span></div>
        {size && (
          <div style={rowStyle}>
            <span style={labelStyle}>dim (cm)</span>
            <span style={valueStyle}>
              {(size[0] * 100).toFixed(1)} × {(size[1] * 100).toFixed(1)} × {(size[2] * 100).toFixed(1)}
            </span>
          </div>
        )}

        {anchors.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>aggancio</div>
            <select
              value={snapTarget ?? ''}
              disabled={readOnly}
              onChange={(e) => handleSnap(e.target.value || null)}
              style={selectStyle}
            >
              <option value="">— libero —</option>
              {anchors.map((a) => (
                <option key={a.id} value={a.id}>{a.id}</option>
              ))}
            </select>
          </div>
        )}

        {myPoints.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>aggancia a pezzo</div>

            {/* Seats still free stay on offer even once the part is joined: a
                piano reaches a montante at each end, and the second joint is
                only a press away. */}
            {nearbySeats()
              .filter((seat) => !jointedSeats.has(`${seat.targetItem.id}|${seat.point.id}`))
              .map((seat) => (
                  <button
                    key={`${seat.myPoint.id}|${seat.targetItem.id}|${seat.point.id}`}
                    type="button"
                    disabled={readOnly}
                    onClick={() => handleJoinToItem(seat)}
                    style={{
                      ...pairBtnStyle,
                      width: '100%',
                      marginBottom: 4,
                      display: 'flex',
                      gap: 6,
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      background: '#24384a',
                      color: '#cfe6ff',
                    }}
                  >
                    <span>
                      Attacca · {snapPointLabel(seat.myPoint)} →{' '}
                      {catalog[seat.targetItem.catalogId]?.label ?? seat.targetItem.catalogId}
                      {seat.targetItem.mirrored ? ' (specchiato)' : ''} · {snapPointLabel(seat.point)}
                    </span>
                    <span style={{ flexShrink: 0, opacity: 0.7 }}>{formatCm(seat.distance)} cm</span>
                  </button>
              ))}

            {joined ? (
              <div style={joinedBoxStyle}>
                {joints.length > 0
                  ? joints.map((joint) => <div key={joint.key}>{joint.label}</div>)
                  : <div>{joinedFromLabel} → {joinedTargetLabel}</div>}
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={handleUnjoin}
                  style={{ ...pairBtnStyle, width: '100%', marginTop: 4, background: '#2a2a35' }}
                >
                  Sgancia
                </button>
              </div>
            ) : (
              <>
                <select
                  value={myPointId ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    setMyPointId(e.target.value || null)
                    setTargetPointId(null)
                    setJoinError(null)
                  }}
                  style={selectStyle}
                >
                  <option value="">— punto di questo pezzo —</option>
                  {groupByKind(myPoints).map(([kind, points]) => (
                    <optgroup key={kind} label={`${snapKindLabel(kind)} (${points.length})`}>
                      {points.map((p) => (
                        <option key={p.id} value={p.id}>{snapPointLabel(p)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                <select
                  value={targetItemId ?? ''}
                  disabled={readOnly || !myPoint}
                  onChange={(e) => {
                    setTargetItemId(e.target.value || null)
                    setTargetPointId(null)
                    setJoinError(null)
                  }}
                  style={{ ...selectStyle, marginTop: 4 }}
                >
                  <option value="">— pezzo di destinazione —</option>
                  {targetItems.map((e) => (
                    <option key={e.item.id} value={e.item.id}>
                      {catalog[e.item.catalogId]?.label ?? e.item.catalogId} · {e.item.id}
                    </option>
                  ))}
                </select>

                <select
                  value={targetPointId ?? ''}
                  disabled={readOnly || !targetEntry}
                  onChange={(e) => {
                    setTargetPointId(e.target.value || null)
                    setJoinError(null)
                  }}
                  style={{ ...selectStyle, marginTop: 4 }}
                >
                  <option value="">
                    {targetEntry && targetPoints.length === 0
                      ? '— nessun punto compatibile —'
                      : '— punto di destinazione —'}
                  </option>
                  {groupByKind(targetPoints).map(([kind, points]) => (
                    <optgroup key={kind} label={`${snapKindLabel(kind)} (${points.length})`}>
                      {points.map((p) => (
                        <option key={p.id} value={p.id}>{snapPointLabel(p)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                <label style={{ ...toggleLabelStyle, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={showAllTargets}
                    onChange={(e) => setShowAllTargets(e.target.checked)}
                  />
                  mostra anche i punti non compatibili
                </label>

                <button
                  type="button"
                  disabled={readOnly || !myPoint || !targetPointId}
                  onClick={() => handleJoinToItem()}
                  style={{
                    ...pairBtnStyle,
                    width: '100%',
                    marginTop: 4,
                    background: myPoint && targetPointId ? '#3aa0ff' : '#1a1a25',
                    color: myPoint && targetPointId ? '#fff' : '#667',
                  }}
                >
                  Aggancia
                </button>
                {joinError && <div style={joinErrorStyle}>{joinError}</div>}
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>rotazione</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" disabled={readOnly} onClick={() => handleRotate(-Math.PI / 2)} style={pairBtnStyle}>
              ⟲ 90°
            </button>
            <button type="button" disabled={readOnly} onClick={() => handleRotate(Math.PI / 2)} style={pairBtnStyle}>
              ⟳ 90°
            </button>
          </div>
        </div>

        {offeredDistances.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>coppia specchiata</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {offeredDistances.map((d) => {
                const active = pair?.distance === d
                const fits = fitsAt(d)
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={readOnly}
                    onClick={() => handlePairDistance(d)}
                    style={{
                      ...pairBtnStyle,
                      flex: 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 6,
                      textAlign: 'left',
                      background: active ? '#3aa0ff' : '#1a1a25',
                      color: active ? '#fff' : '#ddd',
                      borderColor: active ? '#3aa0ff' : '#2a2a35',
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{formatCm(d)} cm</span>
                    <span
                      style={{
                        fontWeight: 400,
                        color: active ? '#e8f4ff' : '#889',
                        // Wraps rather than truncates: a spacing two parts fit
                        // runs past the panel, and an elided second code is
                        // exactly what the row exists to show.
                        textAlign: 'right',
                      }}
                    >
                      {fits.length > 0 ? fits.join(' · ') : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
            {pair && (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => removeMirrorPair(item.id)}
                style={{ ...pairBtnStyle, width: '100%', marginTop: 4, background: '#2a2a35' }}
              >
                Scollega coppia
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button type="button" onClick={() => select(null)} style={{ ...btnStyle, background: '#3a3a45', flex: 1 }}>
            Deseleziona
          </button>
          <button type="button" disabled={readOnly} onClick={() => removeItem(item.id)} style={{ ...btnStyle, background: '#d04040', flex: 1 }}>
            Elimina
          </button>
        </div>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  width: 260,
  // Anchored at the bottom, so the panel grows upward: without a cap it runs
  // off the top of the canvas and silently hides whatever sits highest.
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  background: 'rgba(15, 15, 20, 0.9)',
  color: '#ddd',
  border: '1px solid #2a2a35',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  backdropFilter: 'blur(6px)',
}
const headerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #2a2a35',
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#9aa',
}
const bodyStyle: React.CSSProperties = { padding: 10 }
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, padding: '3px 0' }
const labelStyle: React.CSSProperties = { color: '#778', width: 60, flexShrink: 0 }
const valueStyle: React.CSSProperties = { fontFamily: 'monospace', wordBreak: 'break-all' }
const btnStyle: React.CSSProperties = {
  color: 'white',
  border: 'none',
  padding: '6px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
}
/** Centimetres, one decimal only when it carries information. */
const formatCm = (metres: number) => (metres * 100).toFixed(1).replace(/\.0$/, '')

const pairBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '5px 6px',
  border: '1px solid #2a2a35',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  color: '#ddd',
}
const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#1a1a25',
  color: '#ddd',
  border: '1px solid #2a2a35',
  borderRadius: 4,
  padding: '6px 8px',
  fontFamily: 'monospace',
  fontSize: 12,
}
const joinErrorStyle: React.CSSProperties = {
  marginTop: 5,
  padding: '5px 6px',
  border: '1px solid #d04040',
  borderRadius: 4,
  background: 'rgba(90, 20, 20, 0.5)',
  color: '#ff9b9b',
  fontSize: 10,
}
const toggleLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  color: '#778',
  fontSize: 10,
}
const joinedBoxStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: '#1a2a25',
  border: '1px solid #33ff88',
  borderRadius: 4,
  fontSize: 11,
  wordBreak: 'break-word',
}
