import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useConfiguratorStore } from '../state/store'
import {
  computePartnerPlacement,
  MIRROR_PAIR_RULE,
  mirrorPairConstraint,
  mirrorPairDistances,
  withSnapConstraint,
} from '../scene/mirrorPair'
import {
  assemblyContext,
  canMate,
  itemSnapConstraint,
  itemSnapConstraintFor,
  positionForItemSnap,
  resolveSnappedChildren,
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

  const handleSnap = (anchorId: string | null) => {
    updateItem(item.id, {
      constraints: withSnapConstraint(
        item,
        anchorId ? { type: 'snapToAnchor', target: anchorId } : null,
      ),
    })
  }

  /**
   * Join this item to another product: move it so `myPointId` lands exactly on
   * the chosen point of the target, record the link, then drag along anything
   * already joined to this item.
   */
  const handleJoinToItem = () => {
    if (!myPoint || !targetItemId || !targetPointId) return
    const targetPoint = targetEntry?.points.find((p) => p.id === targetPointId)
    const size = colliderSizeOf(item.id)
    if (!targetPoint || !size) return
    const world = worldSnapPosition(targetItemId, targetPoint.position)
    if (!world) return

    // Turn the item so its mating face presses against the target's, then
    // translate. Faces that point up or down cannot be aligned by yaw, so
    // there the item keeps its current rotation.
    const targetItem = targetEntry?.item
    if (!targetItem) return
    const yaw = yawToMate(myPoint.normal, targetPoint.normal, targetItem?.rotation[1] ?? 0)
    const rotation: Euler =
      yaw === null ? item.rotation : [item.rotation[0], yaw, item.rotation[2]]

    const position = positionForItemSnap(myPoint.position, rotation[1], size[1], world)
    const link = itemSnapConstraintFor(targetItemId, myPoint.id, targetPoint.id)
    const kept = item.constraints?.filter((c) => c.type === 'mirrorPair') ?? []
    const s = useConfiguratorStore.getState()
    const targetDefinition = definitionFor(assemblyManifest, targetItem.catalogId)
    const sourceConnector = connectorForSnap(definitionFor(assemblyManifest, item.catalogId), myPoint)
    const targetConnector = targetPoint ? connectorForSnap(targetDefinition, targetPoint) : undefined
    if (assemblyManifest && (!sourceConnector || !targetConnector || !connectorsCanMate(sourceConnector, myPoint, targetConnector, targetPoint))) {
      setJoinError('Questi connettori non sono autorizzati dal manifest tecnico')
      return
    }
    const connection: Connection | null = sourceConnector && targetConnector
      ? {
          sourceItemId: item.id,
          sourceConnectorId: sourceConnector.id,
          sourcePointId: myPoint.id,
          targetItemId,
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
    const issue = validateConfiguration(preview, s.catalog, assemblyManifest, {
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules,
      enclosureBounds: interiorBBox,
    }).find((candidate) => candidate.level === 'error' && candidate.itemIds.includes(item.id))
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
    setJoinError(null)
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

  const handlePairDistance = (distance: number) => {
    if (!pairRule) return
    const placement = computePartnerPlacement(item, pairRule, distance)
    if (pair?.target) {
      // Already paired: move the partner and update the stored distance on both.
      const setDistance = (it: PlacedItem) =>
        it.constraints?.map((c) => (c.type === 'mirrorPair' ? { ...c, distance } : c))
      const partner = project?.items.find((it) => it.id === pair.target)
      if (!partner) return
      updateItems([
        { id: item.id, patch: { constraints: setDistance(item) } },
        {
          id: partner.id,
          patch: {
            position: placement.position,
            rotation: placement.rotation,
            constraints: setDistance(partner),
          },
        },
      ])
    } else {
      createMirrorPair(
        item.id,
        {
          id: nanoid(8),
          catalogId: item.catalogId,
          position: placement.position,
          rotation: placement.rotation,
          mirrored: placement.mirrored,
        },
        distance,
      )
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

            {joined ? (
              <div style={joinedBoxStyle}>
                <div>
                  {joinedFromLabel} → {joinedTargetLabel}
                </div>
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
                  onClick={handleJoinToItem}
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

        {pairDistances.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>coppia specchiata</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {pairDistances.map((d) => {
                const active = pair?.distance === d
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={readOnly}
                    onClick={() => handlePairDistance(d)}
                    style={{
                      ...pairBtnStyle,
                      background: active ? '#3aa0ff' : '#1a1a25',
                      color: active ? '#fff' : '#ddd',
                      borderColor: active ? '#3aa0ff' : '#2a2a35',
                    }}
                  >
                    {Math.round(d * 100)} cm
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
