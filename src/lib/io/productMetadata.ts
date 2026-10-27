import type { ItemRule, ItemSnapPoint, Vec3 } from '../types'

/** Product-local data in metres, resolved before any placed instance renders. */
export interface ProductMetadata {
  size: Vec3
  snaps: ItemSnapPoint[]
  rules: ItemRule[]
}
