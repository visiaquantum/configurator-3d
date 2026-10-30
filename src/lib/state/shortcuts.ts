import { toggleAssemblyLock } from '../scene/commands'
import type { ConfiguratorState } from './store'

export interface ShortcutKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

export interface Shortcut {
  run: (state: ConfiguratorState) => void
  /** True when the browser's own handling of the key must be suppressed. */
  preventDefault: boolean
}

/**
 * The command a key press runs, or null. Pure, so the key map can be checked
 * without a DOM; the same store actions back the toolbar, inspector and ref.
 * An open attachment only listens to Esc; walk mode owns the keyboard.
 */
export function shortcutFor(key: ShortcutKey, state: Pick<ConfiguratorState, 'attachment' | 'walkMode' | 'selectedId'>): Shortcut | null {
  const mod = key.metaKey || key.ctrlKey
  const k = key.key.toLowerCase()
  if (state.attachment) return key.key === 'Escape' ? { run: (s) => s.setAttachment(null), preventDefault: true } : null
  if (state.walkMode) return null
  if (mod && k === 'z') return { run: (s) => (key.shiftKey ? s.redo() : s.undo()), preventDefault: true }
  if (mod && k === 'y') return { run: (s) => s.redo(), preventDefault: true }
  if (mod) return null
  if (key.key === 'Escape') return { run: (s) => s.select(null), preventDefault: false }
  if (k === 't') return { run: (s) => s.setGizmoMode('translate'), preventDefault: false }
  if (k === 'r') return { run: (s) => s.setGizmoMode('rotate'), preventDefault: false }
  const selected = state.selectedId
  if (!selected) return null
  if (k === 'f') return { run: (s) => s.requestFocusSelected(), preventDefault: false }
  if (k === 'l') return { run: (s) => toggleAssemblyLock(s, selected), preventDefault: false }
  if (key.key === 'Delete' || key.key === 'Backspace') return { run: (s) => s.removeItem(selected), preventDefault: false }
  return null
}
