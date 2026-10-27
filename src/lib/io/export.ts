import { Mesh, MeshStandardMaterial } from 'three'
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three'
import type { AssemblyManifest, CatalogItem, ProjectData, ValidationIssue } from '../types'
import { definitionFor } from '../assembly/manifest'
import { enclosureGeometryForExport } from '../scene/enclosureCutaway'

export interface BomLine {
  code: string
  label: string
  quantity: number
}

/** Build a technical BOM from placed products and connector-declared hardware. */
export function buildProjectBom(
  project: ProjectData,
  catalog: CatalogItem[],
  manifest?: AssemblyManifest | null,
): BomLine[] {
  // Keyed by code and label: two different parts that happen to share a code
  // stay two lines instead of one under the first label.
  const lines = new Map<string, BomLine>()
  const add = (code: string, label: string, quantity: number) => {
    const key = JSON.stringify([code, label])
    const existing = lines.get(key)
    if (existing) existing.quantity += quantity
    else lines.set(key, { code, label, quantity })
  }
  for (const item of project.items) {
    const definition = definitionFor(manifest, item.catalogId)
    const catalogItem = catalog.find((candidate) => candidate.id === item.catalogId)
    add(definition?.bom?.code ?? item.catalogId, definition?.bom?.label ?? catalogItem?.label ?? '—', 1)
  }
  // Hardware belongs to the joint, not to whichever part was moved last: both
  // connectors contribute once per joint, whichever end was recorded as source.
  const byId = new Map(project.items.map((item) => [item.id, item]))
  for (const connection of project.connections ?? []) {
    const ends = [[connection.sourceItemId, connection.sourceConnectorId], [connection.targetItemId, connection.targetConnectorId]]
    for (const [itemId, connectorId] of ends) {
      const item = byId.get(itemId)
      const connector = item && definitionFor(manifest, item.catalogId)?.connectors.find((candidate) => candidate.id === connectorId)
      connector?.bomComponents?.forEach((component) => add(component.code, component.label, component.quantity))
    }
  }
  return [...lines.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * Render once and grab the canvas pixels as a PNG data URL.
 *
 * The current frame may have been drawn with the depth/colour buffer left in a
 * non-default state by drei helpers (Environment, etc.) — re-rendering here
 * guarantees a clean frame whose pixels reflect what the user sees.
 */
export function captureCanvasImage(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  mimeType: string = 'image/png',
): string {
  gl.render(scene, camera)
  return gl.domElement.toDataURL(mimeType)
}

/**
 * Like `captureCanvasImage`, as a Blob. The canvas is copied when `toBlob` is
 * called, right after the render, so no data URL round trip (and no
 * `connect-src data:` in the host's CSP) is needed.
 */
export function captureCanvasBlob(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  mimeType: string = 'image/png',
): Promise<Blob> {
  gl.render(scene, camera)
  return new Promise((resolve, reject) => gl.domElement.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('Impossibile catturare l’immagine della scena'))),
    mimeType,
  ))
}

// Bookkeeping the editor stores on scene objects and materials; it must not
// reach the exported file as glTF extras.
const INTERNAL_OBJECT_KEYS = ['exportable', 'configuratorHelper']
const INTERNAL_MATERIAL_KEYS = ['originalColor', 'configuratorMaterial']
const withoutKeys = (data: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)))

/**
 * Export the given Object3D roots as a binary glTF (.glb) Blob.
 * `roots` should be the exportable geometry only (enclosure + placed items),
 * not the whole scene — otherwise grid/environment/gizmo helpers leak in.
 */
export async function exportSceneGLB(roots: Object3D[]): Promise<Blob> {
  // Export libraries are needed only when the user asks for an output. Lazy
  // loading keeps the initial configurator bundle focused on the 3D editor.
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  // One export copy per live material, shared by every mesh using it, so the
  // exporter can still deduplicate materials.
  const copies = new Map<Material, Material>()
  const cleaned = roots.map((root) => {
    root.updateWorldMatrix(true, true)
    const clone = root.clone(true)
    root.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale)
    const helpers: Object3D[] = []
    clone.traverse((object) => {
      if (object.userData.configuratorHelper) helpers.push(object)
      object.userData = withoutKeys(object.userData, INTERNAL_OBJECT_KEYS)
      if (!(object instanceof Mesh)) return
      object.geometry = enclosureGeometryForExport(object.geometry)
      const copy = (material: Material) => {
        const cached = copies.get(material)
        if (cached) return cached
        const result = material.clone()
        if (result instanceof MeshStandardMaterial && typeof material.userData.originalColor === 'number') result.color.set(material.userData.originalColor)
        const original = material.userData.configuratorMaterial
        if (original) { result.transparent = original.transparent; result.opacity = original.opacity; result.depthWrite = original.depthWrite }
        result.userData = withoutKeys(material.userData, INTERNAL_MATERIAL_KEYS)
        copies.set(material, result)
        return result
      }
      object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material)
    })
    helpers.forEach((helper) => helper.removeFromParent())
    return clone
  })
  try {
    return await new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      cleaned,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: 'model/gltf-binary' }))
        } else {
          reject(new Error('Il formato di esportazione non è GLB binario'))
        }
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, embedImages: true },
    )
    })
  } finally {
    copies.forEach((material) => material.dispose())
  }
}

export interface ExportPdfOptions {
  project: ProjectData
  catalog: CatalogItem[]
  /** PNG/JPEG data URL produced by captureCanvasImage. Optional. */
  imageDataUrl?: string
  /** Override the timestamp shown on the document. Defaults to `new Date()`. */
  date?: Date
  manifest?: AssemblyManifest | null
  validationIssues?: ValidationIssue[]
  /** Set only after checking loaded assets, a complete manifest and current geometry. */
  validated?: boolean
}

async function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to decode screenshot for PDF'))
    img.src = dataUrl
  })
}

/**
 * Produce a single-page A4 PDF summarizing the project: title, customer, date,
 * the scene screenshot, and a grouped component count (one row per catalog id).
 */
export async function exportProjectPDF(opts: ExportPdfOptions): Promise<Blob> {
  const { project, catalog, imageDataUrl, date = new Date(), manifest, validationIssues = [] } = opts
  if (validationIssues.some((issue) => issue.level === 'error')) {
    throw new Error('Impossibile generare la BOM: correggi gli errori di configurazione')
  }
  // `jspdf` is an optional peer: only hosts that export PDFs need to install it.
  const { jsPDF } = await import('jspdf').catch(() => {
    throw new Error('Esportazione PDF non disponibile: installare il pacchetto jspdf')
  })
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const PAGE_W = 210
  const MARGIN = 15
  const CONTENT_W = PAGE_W - MARGIN * 2
  const MAX_IMG_H = 130 // mm — keeps room for the components table below

  let y = 20
  const textBlock = (text: string, fontSize = 10) => {
    doc.setFontSize(fontSize)
    const lines: string[] = doc.splitTextToSize(text, CONTENT_W)
    for (const line of lines) {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, MARGIN, y)
      y += fontSize * 0.5
    }
    y += 2
  }
  textBlock(project.metadata?.name ?? project.id, 16)
  if (project.metadata?.customer) textBlock(`Cliente: ${project.metadata.customer}`)
  textBlock(`Data: ${date.toLocaleDateString('it-IT')}`)
  textBlock(`Progetto: ${project.id}`)
  textBlock(opts.validated && manifest ? (validationIssues.length ? `Stato: ${validationIssues.length} segnalazioni` : 'Stato: configurazione validata') : 'Stato: verifica tecnica non eseguita')
  if (manifest) textBlock(`Manifest tecnico: v${manifest.version}`)
  y += 3

  if (imageDataUrl) {
    // Preserve the screenshot's native aspect ratio: fit it inside CONTENT_W ×
    // MAX_IMG_H, scaling down whichever dimension would overflow.
    const { w: natW, h: natH } = await loadImageSize(imageDataUrl)
    const aspect = natW > 0 && natH > 0 ? natW / natH : 16 / 9
    let imgW = CONTENT_W
    let imgH = imgW / aspect
    if (imgH > MAX_IMG_H) {
      imgH = MAX_IMG_H
      imgW = imgH * aspect
    }
    if (y + imgH > 275) { doc.addPage(); y = 20 }
    const fmt = imageDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'
    doc.addImage(imageDataUrl, fmt, MARGIN, y, imgW, imgH, undefined, 'FAST')
    y += imgH + 8
  }

  if (y > 250) { doc.addPage(); y = 20 }
  doc.setFontSize(12)
  doc.text('Componenti', MARGIN, y)
  y += 6
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5
  doc.setFontSize(10)
  doc.text('Codice', MARGIN, y)
  doc.text('Descrizione', MARGIN + 40, y)
  doc.text('Q.tà', PAGE_W - MARGIN - 10, y, { align: 'right' })
  y += 5
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  const lines = buildProjectBom(project, catalog, manifest)

  const tableHeader = () => {
    doc.setFontSize(10)
    doc.text('Codice', MARGIN, y)
    doc.text('Descrizione', MARGIN + 40, y)
    doc.text('Q.tà', PAGE_W - MARGIN - 10, y, { align: 'right' })
    y += 5
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 5
  }
  for (const line of lines) {
    const codes: string[] = doc.splitTextToSize(line.code, 36)
    const labels: string[] = doc.splitTextToSize(line.label, CONTENT_W - 58)
    const height = Math.max(codes.length, labels.length) * 5
    if (y + height > 280) {
      doc.addPage()
      y = 20
      tableHeader()
    }
    // Split unusually long rows across pages while preserving column alignment.
    for (let index = 0; index < Math.max(codes.length, labels.length); index += 1) {
      if (y > 275) { doc.addPage(); y = 20; tableHeader() }
      if (codes[index]) doc.text(codes[index], MARGIN, y)
      if (labels[index]) doc.text(labels[index], MARGIN + 40, y)
      if (index === 0) doc.text(String(line.quantity), PAGE_W - MARGIN - 10, y, { align: 'right' })
      y += 5
    }
    y += 2
  }

  if (project.items.length === 0) {
    doc.setTextColor(120)
    doc.text('(nessun componente)', MARGIN, y)
    doc.setTextColor(0)
  }

  return doc.output('blob')
}

/** Convenience: trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
