import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { configurationStatus } from '../state/readiness'
import { hasBlockingIssues } from '../assembly/validation'
import { downloadBlob } from '../io/export'
import { exportSceneAsBlob } from '../io/sceneExport'
import type { ProjectData } from '../types'
import { Icon } from './Icon'

/** Save and export actions; every export goes through `exportSceneAsBlob`. */
export function Toolbar({
  readOnly,
  onSave,
}: {
  readOnly?: boolean
  onSave?: (p: ProjectData) => void
}) {
  const storeApi = useConfiguratorStoreApi()
  const [busy, setBusy] = useState(false)
  const [exportsOpen, setExportsOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const attachmentOpen = useConfiguratorStore((s) => !!s.attachment)
  useEffect(() => storeApi.subscribe((current, previous) => {
    if (current.attachment && current.attachment !== previous.attachment) setExportsOpen(false)
  }), [storeApi])
  useEffect(() => {
    if (!exportsOpen) return
    const dismiss = (event: PointerEvent) => { if (!toolbarRef.current?.contains(event.target as Node)) setExportsOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && toolbarRef.current?.contains(document.activeElement)) { event.stopPropagation(); setExportsOpen(false) } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [exportsOpen])
  const status = useConfiguratorStore(useShallow(configurationStatus))
  const projectId = useConfiguratorStore((s) => s.project?.id ?? 'scene')
  const validationIssues = useConfiguratorStore((s) => s.validationIssues)
  const canExportBom = status.ready && status.technical && !hasBlockingIssues(validationIssues)
  const download = async (kind: 'png' | 'glb' | 'pdf') => {
    setBusy(true)
    setExportsOpen(false)
    setError(null)
    try {
      const blob = await exportSceneAsBlob(storeApi, kind)
      downloadBlob(blob, `${projectId}.${kind}`)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={toolbarRef} className="cfg-export-toolbar" style={toolbarStyle}>
      {error && <span role="alert" style={{ color: 'var(--cfg-error)', maxWidth: 220, fontSize: 11 }}>{error}</span>}
      {onSave && <button className="cfg-button cfg-primary" disabled={readOnly || attachmentOpen} onClick={() => { const current = storeApi.getState().exportProject(); if (current) onSave(current) }}><Icon name="save" size={15} />Salva</button>}
      <div style={{ position: 'relative' }}>
        <button className="cfg-button" disabled={busy || attachmentOpen} aria-expanded={exportsOpen} onClick={() => setExportsOpen(!exportsOpen)}><Icon name="download" size={16} />{busy ? 'Esportazione…' : 'Esporta'}</button>
        {exportsOpen && <div className="cfg-export-menu">
          <button className="cfg-menu-action" disabled={!status.ready} onClick={() => void download('png')}><Icon name="eye" size={16} />Immagine PNG</button>
          <button className="cfg-menu-action" disabled={!status.ready} onClick={() => void download('glb')}><Icon name="cube" size={16} />Modello 3D · GLB</button>
          <button className="cfg-menu-action" disabled={!canExportBom} onClick={() => void download('pdf')} title={canExportBom ? 'Distinta componenti e configurazione' : 'Completa la validazione prima di esportare'}><Icon name="layers" size={16} />Distinta PDF</button>
          <button className="cfg-menu-action" onClick={() => setExportsOpen(false)}><Icon name="close" size={16} />Chiudi</button>
        </div>}
      </div>
    </div>
  )
}

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 22,
}
