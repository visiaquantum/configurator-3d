import type { Object3D } from 'three'
import type { ItemSnapPoint, Vec3 } from '../types'
import { extractSideHolePairs } from './autoSnapGrid'

const families = new Set(['frontale_int', 'frontale_est', 'laterale_int', 'laterale_est', 'posteriore_int', 'posteriore_est'])
const labels: Record<string, string> = { frontale: 'Frontale', laterale: 'Laterale', posteriore: 'Posteriore' }

/** Geometry is authoritative; preserve previously published IDs and marker calibrations where a real hole matches. */
export function sideHoleSnaps(root: Object3D, previous: ItemSnapPoint[], offset: Vec3, scale: number): ItemSnapPoint[] {
  const old = previous.filter((point) => families.has(point.kind))
  const matched = new Set<ItemSnapPoint>()
  const columns = new Map<string, Array<{ point: ItemSnapPoint; known?: ItemSnapPoint }>>()
  for (const detected of extractSideHolePairs(root, scale)) {
    const point: ItemSnapPoint = { id: detected.id, kind: detected.kind, normal: detected.normal,
      position: detected.position.map((value, axis) => value + offset[axis]) as Vec3 }
    const known = old.find((entry) => !matched.has(entry) && entry.kind === point.kind &&
      entry.normal?.every((value, axis) => Math.abs(value - (point.normal?.[axis] ?? 0)) < 1e-6) &&
      entry.position.every((value, axis) => Math.abs(value - point.position[axis]) < (Math.abs(point.normal?.[axis] ?? 0) > 0.5 ? 0.006 : 0.0001) * scale))
    if (known) matched.add(known)
    const key = `${point.kind}-${[point.position[0], point.position[2]].map((value) => Math.round(value / scale * 10000)).join('_')}`
    columns.set(key, [...(columns.get(key) ?? []), { point, known }])
  }
  const generated: ItemSnapPoint[] = []
  const counts = new Map<string, number>()
  for (const [key, column] of [...columns].sort(([a], [b]) => a.localeCompare(b))) {
    column.sort((a, b) => a.point.position[1] - b.point.position[1])
    const series = `holes-${key}`
    const kind = column[0].point.kind
    const number = (counts.get(kind) ?? 0) + 1
    counts.set(kind, number)
    column.forEach(({ point, known }, index) => {
      const [family, side] = point.kind.split('_')
      const calibrated = known && Math.hypot(...known.position.map((value, axis) => value - point.position[axis])) < 0.001 * scale
      generated.push({ ...point, ...known, position: calibrated ? known.position : point.position, normal: point.normal, series,
        id: known?.id ?? `${series}-${Math.round(point.position[1] / scale * 1e6)}`,
        label: known?.label ?? `${labels[family]} ${side === 'int' ? 'interno' : 'esterno'} · colonna ${number} · foro ${index + 1}` })
    })
  }
  return [...previous.filter((point) => !families.has(point.kind)), ...generated]
}
