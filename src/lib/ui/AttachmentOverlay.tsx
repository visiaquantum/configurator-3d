import { useEffect, useRef } from 'react'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { attachmentPoints, attachmentTargetIds, backAttachment, chooseAttachmentPoint, chooseAttachmentTarget, computeAttachmentPreview } from '../scene/attachment'
import { snapPointLabel, snapsForItem } from '../scene/mating'
import { Icon } from './Icon'

const steps = ['Punto iniziale', 'Destinatario', 'Punto finale']

export function AttachmentOverlay() {
  const store = useConfiguratorStoreApi()
  const state = useConfiguratorStore((value) => value)
  const interaction = state.attachment
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (interaction?.stage === 'menu') menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [interaction?.stage])
  useEffect(() => {
    if (!state.interactionNotice) return
    const timer = window.setTimeout(() => store.setState({ interactionNotice: null }), 4500)
    return () => window.clearTimeout(timer)
  }, [state.interactionNotice, store])
  if (!interaction) return state.interactionNotice ? <div className="cfg-toast" role="status"><Icon name="check" />{state.interactionNotice}</div> : null
  const source = state.project?.items.find((item) => item.id === interaction.sourceItemId)
  if (!source) return null
  const sourceLabel = state.catalog[source.catalogId]?.label ?? source.catalogId
  const selectedSourcePoint = snapsForItem(source, state.itemSnaps, state.itemRules).find((point) => point.id === interaction.sourcePointId)
  if (interaction.stage === 'menu') {
    return <>
      <button className="cfg-menu-dismiss" aria-label="Chiudi menu componente" onClick={() => state.setAttachment(null)} onContextMenu={(event) => { event.preventDefault(); state.setAttachment(null) }} />
      <div ref={menuRef} className="cfg-context-menu" role="dialog" aria-label={`Azioni ${sourceLabel}`} style={{ left: interaction.menuPosition?.[0] ?? 16, top: interaction.menuPosition?.[1] ?? 80 }}>
        <span className="cfg-eyebrow">COMPONENTE</span><strong>{sourceLabel}</strong>
        <button className="cfg-menu-action cfg-accent" disabled={attachmentPoints(state, source.id).length === 0} onClick={() => backAttachment(store)}><Icon name="link" />Aggancia nella scena<Icon name="arrow" size={15} /></button>
        <button className="cfg-menu-action" onClick={() => { state.setAttachment(null); state.requestFocusSelected() }}><Icon name="focus" />Centra componente</button>
        <button className="cfg-menu-action" onClick={() => state.setAttachment(null)}><Icon name="close" />Chiudi</button>
        {attachmentPoints(state, source.id).length === 0 && <small>Nessun punto di snap disponibile.</small>}
      </div>
    </>
  }
  const index = interaction.stage === 'source' ? 0 : interaction.stage === 'target' ? 1 : 2
  const points = interaction.stage === 'source' ? attachmentPoints(state, source.id) : interaction.stage === 'point' && interaction.targetItemId && interaction.sourcePointId
    ? attachmentPoints(state, interaction.targetItemId, { itemId: source.id, pointId: interaction.sourcePointId }) : []
  const hovered = points.find((point) => point.id === interaction.hoveredPointId)
  const preview = interaction.stage === 'point' && interaction.sourcePointId && interaction.targetItemId && interaction.hoveredPointId
    ? computeAttachmentPreview(state, source.id, interaction.sourcePointId, interaction.targetItemId, interaction.hoveredPointId) : null
  const targets = attachmentTargetIds(state)
  const hoveredItem = state.project?.items.find((item) => item.id === interaction.hoveredItemId)
  const title = interaction.stage === 'source' ? 'Scegli il punto sul componente' : interaction.stage === 'target' ? 'Scegli a quale pezzo agganciarlo' : 'Scegli il punto di destinazione'
  const hint = interaction.stage === 'source' ? 'Clicca un punto azzurro nella scena.' : interaction.stage === 'target'
    ? `${targets.size} component${targets.size === 1 ? 'e compatibile' : 'i compatibili'}. Passa sopra un pezzo e clicca per sceglierlo.` : 'Passa su un punto per vedere l’anteprima. Clicca per agganciare.'
  return <div className="cfg-attachment-panel" aria-label="Modalità aggancio">
    <div className="cfg-attachment-heading"><span className="cfg-mode-badge"><Icon name="link" size={15} />AGGANCIO</span><button className="cfg-icon-button" aria-label="Annulla aggancio" title="Annulla aggancio (Esc)" onClick={() => state.setAttachment(null)}><Icon name="close" /></button></div>
    <ol className="cfg-steps">{steps.map((step, number) => <li key={step} className={number === index ? 'active' : number < index ? 'done' : ''}><span>{number < index ? <Icon name="check" size={12} /> : number + 1}</span>{step}</li>)}</ol>
    <h3>{title}</h3><p>{hint}</p>
    <div className="cfg-snap-feedback" role="status" aria-live="polite">
      {interaction.error || (preview && !preview.valid) ? <span className="cfg-error-text">{interaction.error ?? preview?.error}</span>
        : hovered ? <><span className="cfg-point-dot" />{snapPointLabel(hovered)}{preview?.valid && <span className="cfg-positive">Pronto per l’aggancio</span>}</>
          : hoveredItem ? <><Icon name="cube" size={16} />{state.catalog[hoveredItem.catalogId]?.label ?? hoveredItem.catalogId}</> : <span>{sourceLabel}{selectedSourcePoint ? ` · ${snapPointLabel(selectedSourcePoint)}` : ' · scegli un punto'}</span>}
    </div>
    {preview?.warning && <small className="cfg-warning-text">Dopo l’aggancio, sposta o ruota l’assieme per farlo rientrare nel vano.</small>}
    {interaction.stage === 'target' && targets.size === 0 && <small className="cfg-warning-text">Nessun destinatario disponibile per questo punto. Torna indietro per scegliere un altro punto, oppure annulla e aggiungi un componente compatibile.</small>}
    <details className="cfg-point-list"><summary>{interaction.stage === 'target' ? 'Elenco componenti compatibili' : `Elenco punti disponibili (${points.length})`}</summary><div>
      {interaction.stage === 'target' ? (state.project?.items ?? []).filter((item) => targets.has(item.id)).map((item) => <button key={item.id} onClick={() => chooseAttachmentTarget(store, item.id)} onMouseEnter={() => state.setAttachment({ ...interaction, hoveredItemId: item.id })} onMouseLeave={() => state.setAttachment({ ...interaction, hoveredItemId: undefined })}><Icon name="cube" size={15} />{state.catalog[item.catalogId]?.label ?? item.catalogId} · {item.id.slice(0, 4)}</button>)
        : points.map((point, number) => <button key={point.id} onMouseEnter={() => state.setAttachment({ ...interaction, hoveredPointId: point.id, error: undefined })} onMouseLeave={() => state.setAttachment({ ...interaction, hoveredPointId: undefined })} onFocus={() => state.setAttachment({ ...interaction, hoveredPointId: point.id, error: undefined })} onClick={() => chooseAttachmentPoint(store, point.id)}><span>{number + 1}</span>{snapPointLabel(point)}</button>)}
    </div></details>
    <div className="cfg-attachment-footer"><button className="cfg-button cfg-quiet" disabled={index === 0} onClick={() => backAttachment(store)}><Icon name="back" size={16} />Indietro</button><span>Orbita la vista per vedere gli altri punti <kbd>Esc</kbd> per uscire</span></div>
  </div>
}
