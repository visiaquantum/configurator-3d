import type { Camera, Object3D, Scene, WebGLRenderer } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { jsPDF } from 'jspdf'
import type { CatalogItem, ProjectData } from '../types'

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
export function exportSceneGLB(roots: Object3D[]): Promise<Blob> {
  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      roots,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: 'model/gltf-binary' }))
        } else {
          // Fallback: JSON glTF if binary couldn't be produced for some reason.
          resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }))
        }
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, embedImages: true },
    )
  })
}

export interface ExportPdfOptions {
  project: ProjectData
  catalog: CatalogItem[]
  /** PNG/JPEG data URL produced by captureCanvasImage. Optional. */
  imageDataUrl?: string
  /** Override the timestamp shown on the document. Defaults to `new Date()`. */
  date?: Date
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
  const { project, catalog, imageDataUrl, date = new Date() } = opts
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const PAGE_W = 210
  const MARGIN = 15
  const CONTENT_W = PAGE_W - MARGIN * 2
  const MAX_IMG_H = 130 // mm — keeps room for the components table below

  doc.setFontSize(16)
  doc.text(project.metadata?.name ?? project.id, MARGIN, 20)
  doc.setFontSize(10)
  const customer = project.metadata?.customer
  if (customer) doc.text(`Cliente: ${customer}`, MARGIN, 28)
  doc.text(`Data: ${date.toLocaleDateString('it-IT')}`, MARGIN, customer ? 34 : 28)
  doc.text(`Progetto: ${project.id}`, MARGIN, customer ? 40 : 34)

  let y = customer ? 48 : 42

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

  const counts = new Map<string, number>()
  for (const it of project.items) counts.set(it.catalogId, (counts.get(it.catalogId) ?? 0) + 1)

  for (const [catalogId, qty] of counts) {
    const cat = catalog.find((c) => c.id === catalogId)
    doc.text(catalogId, MARGIN, y)
    doc.text(cat?.label ?? '—', MARGIN + 40, y)
    doc.text(String(qty), PAGE_W - MARGIN - 10, y, { align: 'right' })
    y += 5
    if (y > 280) {
      doc.addPage()
      y = 20
    }
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
  URL.revokeObjectURL(url)
}
