import type { AnchorOffsetRule } from '../types'

/** Centimetres with one decimal, without a trailing `.0`. */
export const formatCm = (metres: number) => (metres * 100).toFixed(1).replace(/\.0$/, '')

/** The axes of an anchor distance as the panels name them: scene frame, across and along the vehicle. */
export const ANCHOR_AXIS_FIELDS = [
  { axis: 'x', index: 0, label: 'X · profondità' },
  { axis: 'y', index: 1, label: 'Y · altezza' },
  { axis: 'z', index: 2, label: 'Z · larghezza' },
] as const

/** The fields of the axes a product's `anchorOffset` rule lists. */
export const anchorAxisFields = (rule: AnchorOffsetRule | undefined) => ANCHOR_AXIS_FIELDS.filter(({ axis }) => rule?.[axis] !== undefined)
