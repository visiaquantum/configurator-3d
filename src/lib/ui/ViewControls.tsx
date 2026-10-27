import { useConfiguratorStore } from '../state/store'
import { Icon } from './Icon'

/** View presets, display toggles and the small status overlays around the canvas. */
export function Hints() {
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setGizmoMode = useConfiguratorStore((s) => s.setGizmoMode)
  // Subscribe to lengths, not the arrays themselves, so Hints doesn't re-render
  // when undo/redo stacks mutate by reference but their lengths stay the same.
  const pastLen = useConfiguratorStore((s) => s.past.length)
  const futureLen = useConfiguratorStore((s) => s.future.length)
  const undo = useConfiguratorStore((s) => s.undo)
  const redo = useConfiguratorStore((s) => s.redo)
  const readOnly = useConfiguratorStore((s) => s.readOnly)
  const canUndo = !readOnly && pastLen > 0
  const canRedo = !readOnly && futureLen > 0
  return (
    <div style={hintsStyle}>
      <button type="button" disabled={readOnly} onClick={() => setGizmoMode('translate')} title="Sposta (T)" style={{ ...presetBtn, color: gizmoMode === 'translate' ? 'var(--cfg-accent)' : 'var(--cfg-text-muted)', background: gizmoMode === 'translate' ? 'var(--cfg-accent-soft)' : 'transparent', borderColor: 'transparent' }}>Sposta</button>
      <button type="button" disabled={readOnly} onClick={() => setGizmoMode('rotate')} title="Ruota (R)" style={{ ...presetBtn, color: gizmoMode === 'rotate' ? 'var(--cfg-accent)' : 'var(--cfg-text-muted)', background: gizmoMode === 'rotate' ? 'var(--cfg-accent-soft)' : 'transparent', borderColor: 'transparent' }}>Ruota</button>
      <span style={{ width: 1, height: 18, background: 'var(--cfg-line)', margin: '0 4px' }} />
      <button type="button" disabled={!canUndo} onClick={undo} aria-label="Annulla modifica" title="Annulla (Cmd/Ctrl+Z)" style={iconBtn(canUndo)}><Icon name="undo" size={16} /></button>
      <button type="button" disabled={!canRedo} onClick={redo} aria-label="Ripeti modifica" title="Ripeti (Cmd/Ctrl+Shift+Z)" style={iconBtn(canRedo)}><Icon name="redo" size={16} /></button>
    </div>
  )
}

export function ViewControls() {
  const setCameraPreset = useConfiguratorStore((s) => s.setCameraPreset)
  const requestFocusSelected = useConfiguratorStore((s) => s.requestFocusSelected)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const xrayEnabled = useConfiguratorStore((s) => s.xrayEnabled)
  const setXray = useConfiguratorStore((s) => s.setXrayEnabled)
  const cutawayEnabled = useConfiguratorStore((s) => s.cutawayEnabled)
  const setCutaway = useConfiguratorStore((s) => s.setCutawayEnabled)
  const snapToGridEnabled = useConfiguratorStore((s) => s.snapToGridEnabled)
  const setGrid = useConfiguratorStore((s) => s.setSnapToGridEnabled)
  const gridStep = useConfiguratorStore((s) => s.gridStep)
  const setGridStep = useConfiguratorStore((s) => s.setGridStep)
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  const setWalkMode = useConfiguratorStore((s) => s.setWalkMode)
  const bbox = useConfiguratorStore((s) => s.enclosureBBox)
  const doorsOpen = useConfiguratorStore((s) => s.doorsOpen)
  const setDoorsOpen = useConfiguratorStore((s) => s.setDoorsOpen)

  return (
    <div className="cfg-view-controls" style={viewControlsStyle}>
      <div style={viewRowStyle}>
        <span style={viewLabelStyle}>vista</span>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('top')} title="Vista dall'alto" aria-label="Vista dall'alto">Alto</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('front')} title="Vista frontale" aria-label="Vista frontale">Fronte</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('side')} title="Vista laterale" aria-label="Vista laterale">Lato</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('perspective')} title="Vista prospettica" aria-label="Vista prospettica">3D</button>
        <button
          type="button"
          style={presetBtn}
          aria-label="Centra componente"
          disabled={!selectedId || walkMode}
          onClick={requestFocusSelected}
          title={
            selectedId
              ? 'Centra la vista sul pezzo selezionato (F)'
              : 'Seleziona un pezzo per centrarlo'
          }
        >
          <Icon name="focus" size={14} />
        </button>
        <button
          type="button"
          style={{ ...presetBtn, background: walkMode ? 'var(--cfg-primary)' : presetBtn.background, color: walkMode ? 'var(--cfg-on-primary)' : presetBtn.color }}
          disabled={!bbox}
          onClick={() => setWalkMode(!walkMode)}
          title="POV camminata dentro il furgone (clicca canvas per attivare mouse-look, Esc per uscire)"
        >
          Interno
        </button>
        <button
          type="button"
          style={{ ...presetBtn, background: doorsOpen ? 'var(--cfg-primary)' : presetBtn.background, color: doorsOpen ? 'var(--cfg-on-primary)' : presetBtn.color }}
          onClick={() => setDoorsOpen(!doorsOpen)}
          title="Apri/chiudi le porte del furgone"
        >
          {doorsOpen ? 'Chiudi' : 'Apri'}
        </button>
      </div>
      <div style={viewRowStyle}>
        <span style={viewLabelStyle}>iso</span>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('iso')} title="Vista isometrica anteriore destra" aria-label="Vista isometrica anteriore destra">F DX</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('iso-front-left')} title="Vista isometrica anteriore sinistra" aria-label="Vista isometrica anteriore sinistra">F SX</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('iso-back-right')} title="Vista isometrica posteriore destra" aria-label="Vista isometrica posteriore destra">R DX</button>
        <button type="button" style={presetBtn} disabled={!bbox || walkMode} onClick={() => setCameraPreset('iso-back-left')} title="Vista isometrica posteriore sinistra" aria-label="Vista isometrica posteriore sinistra">R SX</button>
      </div>
      <div style={viewRowStyle}>
        <label style={toggleLabel} title="Nascondi automaticamente le pareti vicine alla camera per vedere l'interno">
          <input type="checkbox" checked={cutawayEnabled} disabled={!bbox || walkMode} onChange={(e) => setCutaway(e.target.checked)} />
          Pareti auto
        </label>
        <label style={toggleLabel}>
          <input
            type="checkbox"
            checked={xrayEnabled}
            onChange={(e) => setXray(e.target.checked)}
          />
          X-ray
        </label>
        <label style={toggleLabel}>
          <input
            type="checkbox"
            checked={snapToGridEnabled}
            onChange={(e) => setGrid(e.target.checked)}
          />
          Griglia
        </label>
        {snapToGridEnabled && (
          <select
            value={gridStep}
            onChange={(e) => setGridStep(parseFloat(e.target.value))}
            style={selectStyle}
            title="Passo griglia"
          >
            <option value={0.01}>1 cm</option>
            <option value={0.025}>2.5 cm</option>
            <option value={0.05}>5 cm</option>
            <option value={0.1}>10 cm</option>
          </select>
        )}
      </div>
    </div>
  )
}

export function WalkHint() {
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  if (!walkMode) return null
  return (
    <div style={walkHintStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>POV camminata attivo</div>
      <div>Click sulla scena → mouse-look · <b>WASD</b>/frecce muovi · <b>Shift</b> corri · <b>Esc</b> esci</div>
    </div>
  )
}

export function ClearanceOverlay() {
  const c = useConfiguratorStore((s) => s.dragClearance)
  if (!c) return null
  const fmt = (v: number) => {
    const cm = v * 100
    const color = cm < 0 ? 'var(--cfg-error)' : cm < 2 ? 'var(--cfg-warning)' : 'var(--cfg-text-muted)'
    return <span style={{ color, fontFamily: 'monospace' }}>{cm.toFixed(1)} cm</span>
  }
  return (
    <div style={clearanceStyle}>
      <div style={{ color: 'var(--cfg-text-subtle)', marginBottom: 4 }}>Distanza pareti</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sx</span>{fmt(c.left)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>dx</span>{fmt(c.right)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>avanti</span>{fmt(c.front)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>dietro</span>{fmt(c.back)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sopra</span>{fmt(c.top)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sotto</span>{fmt(c.bottom)}</div>
    </div>
  )
}

export function CatalogStatusBadge({ text, tone }: { text: string; tone: 'info' | 'error' }) {
  return (
    <div
      style={{
        ...badgeStyle,
        background: tone === 'error' ? 'var(--cfg-error-surface)' : 'var(--cfg-surface)',
        color: tone === 'error' ? 'var(--cfg-error)' : 'var(--cfg-text-muted)',
        border: `1px solid ${tone === 'error' ? 'var(--cfg-error-line)' : 'var(--cfg-line)'}`,
      }}
    >
      {text}
    </div>
  )
}

const hintsStyle: React.CSSProperties = {
  position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 2,
  alignItems: 'center', padding: 5, background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-line)', borderRadius: 8, fontSize: 11,
}

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  padding: '6px 10px',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  maxWidth: 320,
}

const iconBtn = (enabled: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  background: 'transparent', color: enabled ? 'var(--cfg-text-secondary)' : '#94a3b8', border: 0,
  borderRadius: 7, cursor: enabled ? 'pointer' : 'not-allowed',
})

const viewControlsStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 6,
  background: 'var(--cfg-surface)',
  color: 'var(--cfg-text-secondary)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}

const viewRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const viewLabelStyle: React.CSSProperties = {
  color: 'var(--cfg-text-subtle)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginRight: 4,
}

const presetBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--cfg-surface-muted)', color: 'var(--cfg-text-secondary)', border: '1px solid var(--cfg-line)',
  borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 11, minHeight: 30,
}

const toggleLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  cursor: 'pointer',
  color: 'var(--cfg-text-muted)',
  fontSize: 11,
}

const selectStyle: React.CSSProperties = {
  background: 'var(--cfg-surface)',
  color: 'var(--cfg-text-secondary)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 3,
  padding: '1px 4px',
  fontFamily: 'monospace',
  fontSize: 10,
}

const clearanceStyle: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  left: 12,
  padding: '6px 10px',
  background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--cfg-text-secondary)',
  minWidth: 140,
}

const clearanceRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '1px 0',
}

const clearanceLabel: React.CSSProperties = {
  color: 'var(--cfg-text-subtle)',
  fontSize: 10,
}

const walkHintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-accent)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--cfg-text-secondary)',
  pointerEvents: 'none',
  textAlign: 'center',
}
