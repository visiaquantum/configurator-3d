import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore } from '../state/store'
import { configurationStatus } from '../state/readiness'
import type { ValidationIssue } from '../types'
import { Icon } from './Icon'

/** Readiness first, then the first validation issues; clicking one selects its item. */
export function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  const select = useConfiguratorStore((state) => state.select)
  const errors = issues.filter((issue) => issue.level === 'error')
  const status = useConfiguratorStore(useShallow(configurationStatus))
  if (!status.ready || !status.technical) {
    return <div style={validationStyle}>{status.message}</div>
  }
  if (issues.length === 0) {
    return <div style={{ ...validationStyle, borderColor: 'var(--cfg-success-line)', color: 'var(--cfg-success)', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="check" size={14} />Configurazione valida</div>
  }
  return (
    <div style={{ ...validationStyle, borderColor: errors.length ? 'var(--cfg-error-line)' : 'var(--cfg-warning-line)' }}>
      <div style={{ color: errors.length ? 'var(--cfg-error)' : 'var(--cfg-warning)', fontWeight: 600, marginBottom: 4 }}>
        {errors.length ? `${errors.length} errore${errors.length === 1 ? '' : 'i'} da correggere` : 'Avvisi configurazione'}
      </div>
      {issues.slice(0, 3).map((issue, index) => (
        <button
          key={`${issue.code}-${index}`}
          type="button"
          onClick={() => select(issue.itemIds[0] ?? null)}
          style={{ display: 'block', padding: 0, color: 'var(--cfg-text-muted)', background: 'transparent', border: 0, cursor: issue.itemIds[0] ? 'pointer' : 'default', textAlign: 'left', font: 'inherit' }}
          title={issue.itemIds[0] ? 'Seleziona il primo prodotto coinvolto' : undefined}
        >
          {issue.message}
        </button>
      ))}
      {issues.length > 3 && <div style={{ color: 'var(--cfg-text-subtle)', marginTop: 2 }}>+{issues.length - 3} altri</div>}
    </div>
  )
}

const validationStyle: React.CSSProperties = {
  maxWidth: 320,
  flexShrink: 0,
  pointerEvents: 'auto',
  padding: '10px 12px',
  background: 'var(--cfg-surface)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}
