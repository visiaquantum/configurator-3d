import { nanoid } from 'nanoid'
import { useConfiguratorStore } from '../state/store'
import {
  computePartnerPlacement,
  MIRROR_PAIR_RULE,
  mirrorPairConstraint,
  mirrorPairDistances,
  withSnapConstraint,
} from '../scene/mirrorPair'
import type { PlacedItem } from '../types'

interface Props {
  readOnly?: boolean
}

export function Inspector({ readOnly }: Props) {
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const removeItem = useConfiguratorStore((s) => s.removeItem)
  const updateItem = useConfiguratorStore((s) => s.updateItem)
  const updateItems = useConfiguratorStore((s) => s.updateItems)
  const createMirrorPair = useConfiguratorStore((s) => s.createMirrorPair)
  const removeMirrorPair = useConfiguratorStore((s) => s.removeMirrorPair)
  const select = useConfiguratorStore((s) => s.select)
  const catalog = useConfiguratorStore((s) => s.catalog)
  const itemRules = useConfiguratorStore((s) => s.itemRules)

  const runtimeAnchors = useConfiguratorStore((s) => s.runtimeAnchors)
  const item = project?.items.find((it) => it.id === selectedId)
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

  const handleSnap = (anchorId: string | null) => {
    updateItem(item.id, {
      constraints: withSnapConstraint(
        item,
        anchorId ? { type: 'snapToAnchor', target: anchorId } : null,
      ),
    })
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
