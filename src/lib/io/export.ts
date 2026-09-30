import { Mesh, MeshStandardMaterial } from 'three'
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three'
import type { AssemblyManifest, CatalogItem, ProjectData, ValidationIssue } from '../types'
import { definitionFor } from '../assembly/manifest'

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
  const lines = new Map<string, BomLine>()
  const add = (code: string, label: string, quantity: number) => {
    const existing = lines.get(code)
    if (existing) existing.quantity += quantity
    else lines.set(code, { code, label, quantity })
  }
  for (const item of project.items) {
    const definition = definitionFor(manifest, item.catalogId)
    const catalogItem = catalog.find((candidate) => candidate.id === item.catalogId)
    add(definition?.bom?.code ?? item.catalogId, definition?.bom?.label ?? catalogItem?.label ?? '—', 1)
  }
  for (const connection of project.connections ?? []) {
    const source = project.items.find((item) => item.id === connection.sourceItemId)
    if (!source) continue
    const connector = definitionFor(manifest, source.catalogId)?.connectors.find(
      (candidate) => candidate.id === connection.sourceConnectorId,
    )
    connector?.bomComponents?.forEach((component) => add(component.code, component.label, component.quantity))
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
 * Export the given Object3D roots as a binary glTF (.glb) Blob.
 * `roots` should be the exportable geometry only (enclosure + placed items),
 * not the whole scene — otherwise grid/environment/gizmo helpers leak in.
 */
export async function exportSceneGLB(roots: Object3D[]): Promise<Blob> {
  // Export libraries are needed only when the user asks for an output. Lazy
  // loading keeps the initial configurator bundle focused on the 3D editor.
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  const materials: Material[] = []
  const cleaned = roots.map((root) => {
    root.updateWorldMatrix(true, true)
    const clone = root.clone(true)
    root.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale)
    const helpers: Object3D[] = []
    clone.traverse((object) => {
      if (object.userData.configuratorHelper) helpers.push(object)
      if (!(object instanceof Mesh)) return
      const copy = (material: Material) => {
        const result = material.clone()
        if (result instanceof MeshStandardMaterial && material.userData.originalColor) result.color.set(material.userData.originalColor)
        result.transparent = false
        result.opacity = 1
        result.depthWrite = true
        materials.push(result)
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
    materials.forEach((material) => material.dispose())
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
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const PAGE_W = 210
  const MARGIN = 15
  const CONTENT_W = PAGE_W - MARGIN * 2
  const MAX_IMG_H = 130 // mm — keeps room for the components table below

  doc.setFontSize(16)
  const title = doc.splitTextToSize(project.metadata?.name ?? project.id, CONTENT_W)
  doc.text(title.slice(0, 3), MARGIN, 20)
  doc.setFontSize(10)
  const customer = project.metadata?.customer
  if (customer) doc.text(`Cliente: ${customer}`, MARGIN, 28)
  doc.text(`Data: ${date.toLocaleDateString('it-IT')}`, MARGIN, customer ? 34 : 28)
  doc.text(`Progetto: ${project.id}`, MARGIN, customer ? 40 : 34)
  doc.setTextColor(validationIssues.some((issue) => issue.level === 'error') ? 180 : 30, validationIssues.some((issue) => issue.level === 'error') ? 50 : 120, 80)
  doc.text(opts.validated && manifest ? (validationIssues.length ? `Stato: ${validationIssues.length} segnalazioni` : 'Stato: configurazione validata') : 'Stato: verifica tecnica non eseguita', MARGIN + 75, customer ? 40 : 34)
  doc.setTextColor(0)
  if (manifest) doc.text(`Manifest tecnico: v${manifest.version}`, MARGIN + 75, customer ? 46 : 40)

  let y = manifest ? (customer ? 53 : 47) : (customer ? 48 : 42)

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
    const fmt = imageDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'
    doc.addImage(imageDataUrl, fmt, MARGIN, y, imgW, imgH, undefined, 'FAST')
    y += imgH + 8
  }

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
