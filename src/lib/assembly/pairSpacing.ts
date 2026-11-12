import type { AssemblyManifest, CatalogItem, ItemRule, ItemSnapPoint } from '../types'
import { DEFAULT_SNAP_TOLERANCE, connectorForSnap, connectorsCanMate, definitionFor } from './manifest'
import { canMate, yawToMate } from '../scene/mating'
import { rotateVector } from '../scene/geometry'
import { MIRROR_PAIR_RULE, mirrorAxisOf, mirrorPairDistances, pairDistanceForSpan } from '../scene/mirrorPair'
import type { Vec3 } from '../types'
import { own } from '../util/record'

export interface PairSpacingOption {
  /** Spacing between the two rule reference points, in metres. */
  distance: number
  /** Labels of the catalogue parts this spacing seats; empty for a free spacing. */
  fits: string[]
}

/** Catalogue-declared points replace generated ones of the same kind. */
function certifiedPoints(points: ItemSnapPoint[], declared: ItemSnapPoint[] | undefined): ItemSnapPoint[] {
  if (!declared?.length) return points
  const ids = new Set(declared.map((p) => p.id))
  const kinds = new Set(declared.map((p) => p.kind))
  return points.filter((p) => ids.has(p.id) || !kinds.has(p.kind))
}

/**
 * Spacings a mirror pair of `catalogId` can be set to, smallest first.
 *
 * The GLB's own `distances` are offered, plus every spacing that actually
 * takes a horizontal, worked out from the parts themselves: a part seats when
 * the gap equals its end-to-end span minus the insertion margin at each end.
 * Only the seats the catalogue declares count — a perforated upright also
 * carries dozens of generated hole centres, and pairing those off would be
 * noise — and only parts whose manifest connectors accept this product's.
 */
export function pairSpacingOptions(
  catalogId: string,
  context: {
    catalog: Record<string, CatalogItem>
    itemSnaps: Record<string, ItemSnapPoint[]>
    itemRules: Record<string, ItemRule[]>
    manifest: AssemblyManifest | null
  },
): PairSpacingOption[] {
  const rule = own(context.itemRules, catalogId)?.find((r) => r.rule === MIRROR_PAIR_RULE)
  if (!rule) return []
  const myDefinition = definitionFor(context.manifest, catalogId)
  const myConnectors = myDefinition?.connectors ?? []
  const matesWithMe = (otherId: string) =>
    (definitionFor(context.manifest, otherId)?.connectors ?? []).some((theirs) =>
      myConnectors.some((mine) =>
        (theirs.compatibleWith?.includes(mine.id) ?? false) || (mine.compatibleWith?.includes(theirs.id) ?? false)))

  const seating = new Map<number, string[]>()
  for (const part of Object.values(context.catalog)) {
    if (part.id === catalogId || !matesWithMe(part.id)) continue
    const partDefinition = definitionFor(context.manifest, part.id)
    // The manifest decides what a seat takes, as for every other joint; the
    // kind table only covers points without connectors on either side.
    const takes = (seat: ItemSnapPoint, point: ItemSnapPoint) => {
      const seatConnector = connectorForSnap(myDefinition, seat)
      const pointConnector = connectorForSnap(partDefinition, point)
      return seatConnector && pointConnector
        ? connectorsCanMate(seatConnector, seat, pointConnector, point)
        : canMate(seat.kind, point.kind)
    }
    const points = certifiedPoints(own(context.itemSnaps, part.id) ?? part.snapPoints ?? [], part.snapPoints)
    for (const seat of own(context.itemSnaps, catalogId) ?? own(context.catalog, catalogId)?.snapPoints ?? []) {
      const fitting = points.filter((point) => takes(seat, point))
      for (const a of fitting) {
        for (const b of fitting) {
          if (a === b) continue
          const yaw = yawToMate(a.normal, seat.normal, 0)
          const delta = rotateVector(a.position.map((value, i) => value - b.position[i]) as Vec3, [0, yaw ?? 0, 0])
          const spanAxis = mirrorAxisOf(rule) === 'z' ? 2 : 0
          // Points on different rows or on the same end do not define a bay.
          if (yaw !== null && delta.some((value, axis) => axis !== spanAxis && Math.abs(value) > DEFAULT_SNAP_TOLERANCE)) continue
          const span = yaw === null ? Math.hypot(...delta) : Math.abs(delta[spanAxis])
          if (span <= DEFAULT_SNAP_TOLERANCE) continue
          const key = Math.round(pairDistanceForSpan(rule, span, seat.position) * 1000) / 1000
          if (key <= 0) continue
          const labels = seating.get(key) ?? []
          if (!labels.includes(part.label)) seating.set(key, [...labels, part.label])
        }
      }
    }
  }
  const fitsAt = (distance: number) => {
    for (const [key, labels] of seating) if (Math.abs(key - distance) <= DEFAULT_SNAP_TOLERANCE) return labels
    return []
  }
  return [...new Set([...mirrorPairDistances(rule), ...seating.keys()])]
    .sort((a, b) => a - b)
    .map((distance) => ({ distance, fits: fitsAt(distance) }))
}
