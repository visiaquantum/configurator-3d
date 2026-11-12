import { z } from 'zod'
import type { ItemSnapPoint, SnapRepeat, Vec3 } from '../types'

export const SnapRepeatsSchema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  snapId: z.string().min(1),
  pitch: z.tuple([z.number(), z.number(), z.number()])
    .refine((pitch) => Math.hypot(...pitch) >= 1e-6, 'Pitch must be at least 0.001 mm'),
  label: z.string().min(1).optional(),
})).superRefine((rows, ctx) => {
  for (const key of ['id', 'snapId'] as const) {
    const seen = new Set<string>()
    rows.forEach((row, i) => {
      if (seen.has(row[key])) ctx.addIssue({ code: 'custom', path: [i, key], message: `Duplicate ${key}` })
      seen.add(row[key])
    })
  }
})

/** Replace each seed with its row, including row 1 exactly at the authored marker. */
export function repeatSnapMarkers(points: ItemSnapPoint[], repeats: SnapRepeat[], bounds: { min: Vec3; max: Vec3 }, scale: number): ItemSnapPoint[] {
  const seeds = new Set(repeats.map((row) => row.snapId))
  const result = points.filter((point) => !seeds.has(point.id))
  const used = new Set(result.map((point) => point.id))
  for (const row of repeats) {
    const seed = points.find((point) => point.id === row.snapId)
    if (!seed) throw new Error(`Marker iniziale ${row.snapId} assente per la serie ${row.id}`)
    const pitch = row.pitch.map((value) => value * scale) as Vec3
    let steps = Infinity
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(pitch[axis]) < 1e-12) continue
      const origin = seed.position[axis]
      if (origin < bounds.min[axis] - 1e-6 || origin > bounds.max[axis] + 1e-6) {
        throw new Error(`Marker iniziale ${row.snapId} fuori dal corpo lungo il passo`)
      }
      const limit = pitch[axis] > 0 ? bounds.max[axis] : bounds.min[axis]
      steps = Math.min(steps, (limit - origin) / pitch[axis])
    }
    const count = Math.floor(steps + 1e-6) + 1
    if (!Number.isFinite(count) || count < 1 || count > 10000) throw new Error(`Passo non valido per la serie ${row.id}`)
    for (let i = 0; i < count; i++) {
      const id = `${row.id}-${i + 1}`
      if (used.has(id)) throw new Error(`Punto di aggancio duplicato: ${id}`)
      used.add(id)
      result.push({
        ...seed, id,
        label: `${row.label ?? seed.label ?? seed.kind} ${i + 1}`,
        position: seed.position.map((value, axis) => value + pitch[axis] * i) as Vec3,
      })
    }
  }
  return result
}
