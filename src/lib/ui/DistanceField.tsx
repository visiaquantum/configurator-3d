import { useState } from 'react'
import { formatCm } from './anchorDistance'

interface Props {
  label: string
  metres: number
  disabled?: boolean
  /** Commit every valid keystroke, for a value that only drives a preview. Default: on Enter or on leaving the field. */
  live?: boolean
  onCommit: (metres: number) => void
}

/**
 * A distance typed in centimetres. While it is not being edited it shows the
 * stored value, so a distance the command limited or refused never stays on
 * screen.
 */
export function DistanceField({ label, metres, disabled, live, onCommit }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (text: string | null) => {
    const value = text === null || text.trim() === '' ? NaN : Number(text)
    if (Number.isFinite(value) && formatCm(value / 100) !== formatCm(metres)) onCommit(value / 100)
  }
  return (
    <label>
      <b>{label}</b>
      <input type="number" inputMode="decimal" step={0.1} disabled={disabled} value={draft ?? formatCm(metres)}
        onChange={(event) => { setDraft(event.target.value); if (live) commit(event.target.value) }}
        onBlur={() => { if (!live) commit(draft); setDraft(null) }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    </label>
  )
}
