import type { ProjectData } from '../types'

/** A4 landscape sheet, in millimetres. */
const PAGE_W = 297
const MARGIN = 10
const FRAME_TOP = 10
const FRAME_H = 168
const FRAME_W = PAGE_W - MARGIN * 2
const FRAME_PADDING = 3
const BLOCK_TOP = FRAME_TOP + FRAME_H + 4

/** Size of the image that fills the drawing area at `width` pixels. */
export function isometricSheetImageSize(width = 2400) {
  const aspect = (FRAME_W - FRAME_PADDING * 2) / (FRAME_H - FRAME_PADDING * 2)
  return { width, height: Math.round(width / aspect) }
}

export interface IsometricSheetView {
  label: string
  /** PNG or JPEG data URL. */
  dataUrl: string
  width: number
  height: number
}

export interface IsometricSheetOptions {
  project: ProjectData
  views: IsometricSheetView[]
  /** PNG or JPEG data URL drawn at the left of the title block. */
  logo?: string
  date?: Date
}

const imageFormat = (dataUrl: string) => (dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG')

/**
 * One A4 landscape sheet per view: the drawing inside a frame, and a title
 * block below it with the project, customer, quote number and vehicle.
 */
export async function exportIsometricSheetPDF({ project, views, logo, date = new Date() }: IsometricSheetOptions): Promise<Blob> {
  if (views.length === 0) throw new Error('Nessuna vista isometrica da esportare')
  // `jspdf` is an optional peer: only hosts that export PDFs need to install it.
  const { jsPDF } = await import('jspdf').catch(() => {
    throw new Error('Esportazione PDF non disponibile: installare il pacchetto jspdf')
  })
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const metadata = project.metadata ?? {}
  const title = metadata.name ?? project.id
  const fit = (text: string, width: number) => {
    const lines: string[] = doc.splitTextToSize(text, width)
    return lines.length > 1 ? `${lines[0].replace(/\s+\S*$/, '')}…` : lines[0] ?? ''
  }

  views.forEach((view, index) => {
    if (index > 0) doc.addPage('a4', 'landscape')
    doc.setDrawColor(0)
    doc.setLineWidth(0.3)
    doc.rect(MARGIN, FRAME_TOP, FRAME_W, FRAME_H)

    // The image keeps its aspect ratio, centred in the drawing area.
    const areaW = FRAME_W - FRAME_PADDING * 2
    const areaH = FRAME_H - FRAME_PADDING * 2
    const aspect = view.width > 0 && view.height > 0 ? view.width / view.height : areaW / areaH
    const imageW = Math.min(areaW, areaH * aspect)
    const imageH = imageW / aspect
    doc.addImage(view.dataUrl, imageFormat(view.dataUrl), MARGIN + FRAME_PADDING + (areaW - imageW) / 2, FRAME_TOP + FRAME_PADDING + (areaH - imageH) / 2, imageW, imageH, undefined, 'FAST')

    // Title block.
    let left = MARGIN
    if (logo) {
      const logoProps = doc.getImageProperties(logo)
      const logoH = 18
      const logoW = Math.min(50, logoH * (logoProps.width / logoProps.height))
      doc.addImage(logo, imageFormat(logo), MARGIN, BLOCK_TOP, logoW, Math.min(logoH, logoW * (logoProps.height / logoProps.width)), undefined, 'FAST')
      left = MARGIN + logoW + 6
    }
    const right = PAGE_W - MARGIN
    const columnW = right - left
    doc.setTextColor(0)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(fit(metadata.quoteNumber ? `Nr. ${metadata.quoteNumber}` : title, columnW * 0.4), left, BLOCK_TOP + 4)
    doc.setFont('helvetica', 'normal')
    if (metadata.customer) doc.text(fit(metadata.customer, columnW * 0.58), left + columnW * 0.42, BLOCK_TOP + 4)
    doc.setFontSize(10)
    const description = metadata.vehicle ?? (metadata.quoteNumber ? title : `Progetto: ${project.id}`)
    doc.text(fit(description, columnW), left, BLOCK_TOP + 10.5)
    doc.setTextColor(90)
    doc.text(fit(view.label, columnW * 0.6), left, BLOCK_TOP + 17)
    doc.text(`${date.toLocaleDateString('it-IT')} · Tavola ${index + 1} di ${views.length}`, right, BLOCK_TOP + 17, { align: 'right' })
    doc.setTextColor(0)
  })

  return doc.output('blob')
}
