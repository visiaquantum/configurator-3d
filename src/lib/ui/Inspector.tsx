import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { selectAssemblyView, selectCanMove, selectEffectiveAnchors, selectJoints, selectSelectedItem } from '../state/selectors'
import { mirrorPairConstraint } from '../scene/mirrorPair'
import { assemblyMembers } from '../assembly/graph'
import { pairSpacingOptions } from '../assembly/pairSpacing'
import { attachmentPoints, beginAttachment } from '../scene/attachment'
import { rotateAssembly } from '../scene/itemMovement'
import { setMirrorPairDistance, snapAssemblyToAnchor, unjoinItem } from '../scene/commands'
import { Icon } from './Icon'
import { own } from '../util/record'

interface Props { readOnly?: boolean }

export function Inspector({ readOnly: hostReadOnly }: Props) {
  const storeApi = useConfiguratorStoreApi()
  // Project and metadata only: a drag elsewhere in the scene must not re-render the panel.
  const state = useConfiguratorStore(useShallow(selectAssemblyView))
  const selectedId = useConfiguratorStore((value) => value.selectedId)
  const anchors = useConfiguratorStore(selectEffectiveAnchors)
  const graph = useConfiguratorStore(selectJoints)
  const { project, catalog, itemRules, itemSnaps, assemblyManifest } = state
  const item = project?.items.find((entry) => entry.id === selectedId)
  const catalogId = useConfiguratorStore((value) => selectSelectedItem(value)?.catalogId)
  const spacings = useMemo(() => catalogId ? pairSpacingOptions(catalogId, { catalog, itemSnaps, itemRules, manifest: assemblyManifest }) : [],
    [catalogId, catalog, itemSnaps, itemRules, assemblyManifest])
  if (!item || !project || state.attachment) return null
  const { removeMirrorPair, removeItem, select } = storeApi.getState()
  const members = assemblyMembers(project.items, graph, item.id)
  const readOnly = hostReadOnly || !selectCanMove(state, item.id)
  const cat = own(catalog, item.catalogId)
  const [x, y, z] = item.position
  const size = own(state.itemSizes, item.catalogId) ?? cat?.size
  const snapTarget = item.constraints?.find((constraint) => constraint.type === 'snapToAnchor')?.target
  const joints = graph.filter((joint) => joint.sourceItemId === item.id || joint.targetItemId === item.id)
  const canAttach = attachmentPoints(state, item.id).length > 0
  const pair = mirrorPairConstraint(item)

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
          <button className="cfg-button" style={{ flex: 1 }} disabled={readOnly} onClick={() => rotateAssembly(storeApi, item.id, -Math.PI / 2)} aria-label="Ruota di -90 gradi"><Icon name="rotate" size={16} />−90°</button>
          <button className="cfg-button" style={{ flex: 1 }} disabled={readOnly} onClick={() => rotateAssembly(storeApi, item.id, Math.PI / 2)} aria-label="Ruota di +90 gradi"><Icon name="rotate" size={16} style={{ transform: 'scaleX(-1)' }} />+90°</button>
        </div>
        {joints.length > 0 && <details><summary>{joints.length} {joints.length === 1 ? 'aggancio' : 'agganci'} in questo componente</summary><p style={{ color: 'var(--cfg-text-muted)', lineHeight: 1.6 }}>Fa parte di un assieme di {members.size} componenti. Muovendolo, sposti l’assieme.</p><button className="cfg-button" disabled={readOnly} onClick={() => unjoinItem(storeApi, item.id)}>Sgancia componente</button></details>}
        {spacings.length > 0 && <details open={!!pair}><summary>Coppia specchiata {pair ? '· attiva' : ''}</summary><div className="cfg-pair-options">
          {spacings.map(({ distance, fits }) => <button key={distance} disabled={readOnly} aria-pressed={pair?.distance === distance} onClick={() => setMirrorPairDistance(storeApi, item.id, distance)}><span>{formatCm(distance)} cm</span><span>{fits.join(' · ') || 'Distanza libera'}</span></button>)}
          {pair && <button disabled={readOnly} onClick={() => removeMirrorPair(item.id)}>Scollega coppia</button>}
        </div></details>}
        {anchors.length > 0 && <details><summary>Posizionamento nel vano</summary><select aria-label="Punto del vano" disabled={readOnly} value={snapTarget ?? ''} onChange={(event) => snapAssemblyToAnchor(storeApi, item.id, event.target.value || null)} style={{ width: '100%', background: 'var(--cfg-surface-muted)', color: 'var(--cfg-text-secondary)', border: '1px solid var(--cfg-line)', padding: 9, borderRadius: 8, marginTop: 10, fontSize: 12 }}><option value="">Posizione libera</option>{anchors.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.id}</option>)}</select></details>}
      </div>
      <div className="cfg-inspector-footer">
        <small style={{ color: 'var(--cfg-text-subtle)', fontSize: 11 }}>{readOnly ? 'Componente bloccato' : 'Tasto destro per le azioni'}</small>
        <button className="cfg-icon-button" disabled={readOnly} onClick={() => removeItem(item.id)} aria-label="Elimina componente" title="Elimina componente" style={{ color: 'var(--cfg-error)' }}><Icon name="trash" size={16} /></button>
      </div>
    </section>
  )
}

const formatCm = (metres: number) => (metres * 100).toFixed(1).replace(/\.0$/, '')
