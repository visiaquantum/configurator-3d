import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { selectAssemblyView, selectEffectiveAnchors } from '../state/selectors'
import type { AssemblyView } from '../state/selectors'
import { attachToItemsInstead, attachmentPointStates, attachmentPoints, attachmentTargetIds, attachmentTargetStates, backAttachment, chooseAttachmentAnchor, chooseAttachmentTarget, computeAnchorPlacement, computeAttachmentPreview, selectAttachmentPoint, confirmAttachment, setAttachmentAnchorDistance } from '../scene/attachment'
import type { AttachmentPointState } from '../scene/attachment'
import { anchorOffsetRule } from '../scene/itemMovement'
import { snapPointLabel, snapsForItem } from '../scene/mating'
import { pairSpacingOptions } from '../assembly/pairSpacing'
import { MIRROR_PAIR_RULE, mirrorPairConstraint } from '../scene/mirrorPair'
import { setMirrorPairDistance } from '../scene/commands'
import { Icon } from './Icon'
import { DistanceField } from './DistanceField'
import { anchorAxisFields, formatCm } from './anchorDistance'
import { own } from '../util/record'

const STATUS_LABELS: Record<AttachmentPointState['status'], string> = {
  free: 'Libero', occupied: 'Occupato', incompatible: 'Non compatibile', 'bay-not-allowed': 'Campata non ammessa',
}

const steps = ['Punto iniziale', 'Destinatario', 'Punto finale']
const anchorSteps = ['Punto di base', 'Ancoraggio', 'Distanze']

export function AttachmentOverlay() {
  const store = useConfiguratorStoreApi()
  const [showUnavailable, setShowUnavailable] = useState(false)
  const view = useConfiguratorStore(useShallow(selectAssemblyView))
  const interactionNotice = useConfiguratorStore((value) => value.interactionNotice)
  // Actions never change; reading them from the live state keeps the view the only subscription.
  const { setAttachment, requestFocusSelected } = store.getState()
  const state = { ...view, interactionNotice, setAttachment, requestFocusSelected }
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
  const sourceLabel = own(state.catalog, source.catalogId)?.label ?? source.catalogId
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
  if (interaction.stage === 'anchor') return <AnchorStage view={view} sourceLabel={sourceLabel} pointLabel={selectedSourcePoint ? snapPointLabel(selectedSourcePoint) : ''} />
  const index = interaction.stage === 'source' ? 0 : interaction.stage === 'target' ? 1 : 2
  // Every interface is listed, with its height and whether it is free: the
  // ones that cannot take this part say why instead of disappearing.
  const pointStates = interaction.stage === 'source' ? attachmentPointStates(state, source.id) : interaction.stage === 'point' && interaction.targetItemId && interaction.sourcePointId
    ? attachmentPointStates(state, interaction.targetItemId, { itemId: source.id, pointId: interaction.sourcePointId }) : []
  const points = pointStates.filter((entry) => entry.status === 'free').map((entry) => entry.point)
  const targetStates = interaction.stage === 'target' ? attachmentTargetStates(state) : []
  const targetItem = interaction.stage === 'point' ? state.project?.items.find((item) => item.id === interaction.targetItemId) : undefined
  // A half without its twin: offer the spacings that seat this part, so the other end lands too.
  const spacings = targetItem && !mirrorPairConstraint(targetItem) && own(state.itemRules, targetItem.catalogId)?.some((rule) => rule.rule === MIRROR_PAIR_RULE)
    ? pairSpacingOptions(targetItem.catalogId, { catalog: state.catalog, itemSnaps: state.itemSnaps, itemRules: state.itemRules, manifest: state.assemblyManifest })
      .filter((option) => option.fits.includes(sourceLabel))
    : []
  const previewPointId = interaction.selectedPointId ?? interaction.hoveredPointId
  const hovered = points.find((point) => point.id === previewPointId)
  const preview = interaction.stage === 'point' && interaction.sourcePointId && interaction.targetItemId && previewPointId
    ? computeAttachmentPreview(state, source.id, interaction.sourcePointId, interaction.targetItemId, previewPointId) : null
  const targets = attachmentTargetIds(state)
  const hoveredItem = state.project?.items.find((item) => item.id === interaction.hoveredItemId)
  const title = interaction.stage === 'source' ? 'Scegli il punto sul componente' : interaction.stage === 'target' ? 'Scegli a quale pezzo agganciarlo' : 'Scegli il punto di destinazione'
  const hint = interaction.stage === 'source' ? 'Clicca o tocca un punto azzurro, oppure sceglilo dall’elenco.' : interaction.stage === 'target'
    ? `${targets.size} component${targets.size === 1 ? 'e compatibile' : 'i compatibili'}. Clicca o tocca un pezzo, oppure sceglilo dall’elenco.` : 'Clicca o tocca un punto, controlla l’anteprima e conferma l’aggancio.'
  return <div className="cfg-attachment-panel" aria-label="Modalità aggancio">
    <div className="cfg-attachment-heading"><span className="cfg-mode-badge"><Icon name="link" size={15} />AGGANCIO</span><button className="cfg-icon-button" aria-label="Annulla aggancio" title="Annulla aggancio (Esc)" onClick={() => state.setAttachment(null)}><Icon name="close" /></button></div>
    <ol className="cfg-steps">{steps.map((step, number) => <li key={step} className={number === index ? 'active' : number < index ? 'done' : ''}><span>{number < index ? <Icon name="check" size={12} /> : number + 1}</span>{step}</li>)}</ol>
    <h3>{title}</h3><p>{hint}</p>
    <div className="cfg-snap-feedback" role="status" aria-live="polite">
      {interaction.error || (preview && !preview.valid) ? <span className="cfg-error-text">{preview && !preview.valid && preview.reason === 'collision' ? 'Collisione: ' : ''}{interaction.error ?? preview?.error}</span>
        : hovered ? <><span className="cfg-point-dot" />{snapPointLabel(hovered)}{preview?.valid && <span className="cfg-positive">Pronto per l’aggancio</span>}</>
          : hoveredItem ? <><Icon name="cube" size={16} />{own(state.catalog, hoveredItem.catalogId)?.label ?? hoveredItem.catalogId}</> : <span>{sourceLabel}{selectedSourcePoint ? ` · ${snapPointLabel(selectedSourcePoint)}` : ' · scegli un punto'}</span>}
    </div>
    {preview?.warning && <small className="cfg-warning-text">Dopo l’aggancio, sposta o ruota l’assieme per farlo rientrare nel vano.</small>}
    {interaction.stage === 'target' && targets.size === 0 && <small className="cfg-warning-text">Nessun destinatario disponibile per questo punto. Torna indietro per scegliere un altro punto, oppure annulla e aggiungi un componente compatibile.</small>}
    {spacings.length > 0 && <div className="cfg-pair-suggestion"><small>Il fianco non ha ancora il gemello: crea la coppia alla campata di questo componente.</small>
      {spacings.map((option) => <button key={option.distance} className="cfg-button" onClick={() => setMirrorPairDistance(store, targetItem!.id, option.distance)}>Crea coppia · campata {formatCm(option.distance)} cm</button>)}</div>}
    {interaction.stage === 'point' && <label className="cfg-point-filter"><input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} />Mostra anche i punti non compatibili</label>}
    <details className="cfg-point-list" open><summary>{interaction.stage === 'target' ? `Componenti nella scena (${targets.size} compatibili)` : `Punti di aggancio (${points.length} liberi su ${pointStates.length})`}</summary><div>
      {interaction.stage === 'target' ? targetStates.map((entry) => {
        const item = state.project!.items.find((candidate) => candidate.id === entry.itemId)!
        const label = `${own(state.catalog, item.catalogId)?.label ?? item.catalogId} · ${item.id.slice(0, 4)}`
        return entry.status === 'available'
          ? <button key={item.id} onClick={() => chooseAttachmentTarget(store, item.id)} onMouseEnter={() => state.setAttachment({ ...interaction, hoveredItemId: item.id })} onMouseLeave={() => state.setAttachment({ ...interaction, hoveredItemId: undefined })}><Icon name="cube" size={15} />{label}</button>
          : <button key={item.id} disabled title={entry.message}><Icon name="cube" size={15} />{label}<em className="cfg-point-status">{entry.message}</em></button>
      })
        : pointStates.filter((entry) => interaction.stage !== 'point' || showUnavailable || entry.status !== 'incompatible').map((entry, number) => <button key={entry.point.id} disabled={entry.status !== 'free'} title={entry.message} data-status={entry.status} aria-pressed={interaction.selectedPointId === entry.point.id}
          onMouseEnter={() => state.setAttachment({ ...interaction, hoveredPointId: entry.point.id, error: undefined })} onMouseLeave={() => state.setAttachment({ ...interaction, hoveredPointId: undefined })}
          onFocus={() => state.setAttachment({ ...interaction, hoveredPointId: entry.point.id, error: undefined })} onClick={() => selectAttachmentPoint(store, entry.point.id)}>
          <span>{number + 1}</span>{snapPointLabel(entry.point)}{entry.heightMm !== null && <small className="cfg-point-height">h {entry.heightMm} mm</small>}<em className="cfg-point-status">{STATUS_LABELS[entry.status]}</em></button>)}
    </div></details>
    {interaction.stage === 'point' && <button className="cfg-button cfg-primary cfg-confirm-attachment" disabled={!interaction.selectedPointId || !preview?.valid} onClick={() => confirmAttachment(store)}>Conferma aggancio</button>}
    <div className="cfg-attachment-footer"><button className="cfg-button cfg-quiet" disabled={index === 0} onClick={() => backAttachment(store)}><Icon name="back" size={16} />Indietro</button><span>Orbita la vista per vedere gli altri punti <kbd>Esc</kbd> per uscire</span></div>
  </div>
}

/**
 * A base point goes on the vehicle: the enclosure's anchors are its only
 * destinations, then the distance from the one chosen. The ghost in the scene
 * and the panel read the same preview.
 */
function AnchorStage({ view, sourceLabel, pointLabel }: { view: AssemblyView; sourceLabel: string; pointLabel: string }) {
  const store = useConfiguratorStoreApi()
  const anchors = useConfiguratorStore(selectEffectiveAnchors)
  const interaction = view.attachment!
  const { setAttachment } = store.getState()
  const source = view.project!.items.find((item) => item.id === interaction.sourceItemId)!
  const anchor = anchors.find((entry) => entry.id === interaction.anchorId)
  const shown = anchor ?? anchors.find((entry) => entry.id === interaction.hoveredAnchorId)
  const preview = shown && interaction.sourcePointId
    ? computeAnchorPlacement(view, source.id, interaction.sourcePointId, shown, anchor ? interaction.anchorDistance : undefined) : null
  const fields = anchorAxisFields(anchorOffsetRule(view, source.catalogId))
  // A base point that also stacks on another product keeps that way out.
  const others = attachmentTargetIds(view).size
  const index = anchor ? 2 : 1
  const hover = (id: string | undefined) => setAttachment({ ...interaction, hoveredAnchorId: id })
  return <div className="cfg-attachment-panel" aria-label="Modalità aggancio">
    <div className="cfg-attachment-heading"><span className="cfg-mode-badge"><Icon name="link" size={15} />ANCORAGGIO</span><button className="cfg-icon-button" aria-label="Annulla aggancio" title="Annulla aggancio (Esc)" onClick={() => setAttachment(null)}><Icon name="close" /></button></div>
    <ol className="cfg-steps">{anchorSteps.map((step, number) => <li key={step} className={number === index ? 'active' : number < index ? 'done' : ''}><span>{number < index ? <Icon name="check" size={12} /> : number + 1}</span>{step}</li>)}</ol>
    <h3>{anchor ? 'Imposta le distanze dall’ancoraggio' : 'Scegli il punto di ancoraggio del furgone'}</h3>
    <p>{anchor ? 'Indica a che distanza dall’ancoraggio va il punto di base, controlla l’anteprima e conferma.' : 'Clicca o tocca un ancoraggio nella scena, oppure sceglilo dall’elenco.'}</p>
    <div className="cfg-snap-feedback" role="status" aria-live="polite">
      {interaction.error || (preview && !preview.valid) ? <span className="cfg-error-text">{interaction.error ?? preview?.error}</span>
        : <><span className="cfg-point-dot" />{sourceLabel} · {pointLabel}{shown ? ` → ${shown.id}` : ''}{anchor && preview?.valid && <span className="cfg-positive">Pronto per l’ancoraggio</span>}</>}
    </div>
    {anchors.length === 0 && <small className="cfg-warning-text">Questo veicolo non ha punti di ancoraggio.</small>}
    {anchor && fields.length > 0 && <>
      <span className="cfg-property-label">Distanza dall’ancoraggio · cm</span>
      <div className="cfg-anchor-offset">{fields.map(({ axis, index: at, label }) =>
        <DistanceField key={`${anchor.id}:${axis}`} live label={label} metres={interaction.anchorDistance?.[at] ?? 0} onCommit={(metres) => setAttachmentAnchorDistance(store, { [axis]: metres })} />)}
      </div>
    </>}
    {anchor && preview?.limited && <small className="cfg-warning-text">Così il componente uscirebbe dal vano: distanza ridotta a {fields.map(({ axis, index: at }) => `${axis.toUpperCase()} ${formatCm(preview.offset?.[at] ?? 0)}`).join(' · ')} cm.</small>}
    <details className="cfg-point-list" open><summary>Punti di ancoraggio del furgone ({anchors.length})</summary><div>
      {anchors.map((entry, number) => <button key={entry.id} aria-pressed={interaction.anchorId === entry.id}
        onMouseEnter={() => hover(entry.id)} onMouseLeave={() => hover(undefined)} onFocus={() => hover(entry.id)}
        onClick={() => chooseAttachmentAnchor(store, entry.id)}><span>{number + 1}</span>{entry.id}</button>)}
    </div></details>
    {!anchor && others > 0 && <button className="cfg-button cfg-quiet" onClick={() => attachToItemsInstead(store)}><Icon name="cube" size={15} />Aggancia invece a un componente ({others})</button>}
    {anchor && <button className="cfg-button cfg-primary cfg-confirm-attachment" disabled={!preview?.valid} onClick={() => confirmAttachment(store)}>Conferma ancoraggio</button>}
    <div className="cfg-attachment-footer"><button className="cfg-button cfg-quiet" onClick={() => backAttachment(store)}><Icon name="back" size={16} />Indietro</button><span>Orbita la vista per vedere gli altri ancoraggi <kbd>Esc</kbd> per uscire</span></div>
  </div>
}
