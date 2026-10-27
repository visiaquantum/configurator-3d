import { z } from 'zod'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const EulerSchema = z.tuple([z.number(), z.number(), z.number()])

const AnchorSchema = z.object({
  id: z.string().min(1),
  position: Vec3Schema,
  normal: Vec3Schema.optional(),
})

const EnclosureSchema = z.object({
  glbUrl: z.string().min(1),
  dimensions: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  scale: z.number().positive().optional(),
  anchors: z.array(AnchorSchema).optional(),
  floor: z.object({
    size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    y: z.number(),
    color: z.string().min(1).optional(),
  }).optional(),
  doors: z.record(z.string().min(1), z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('rotate'), axis: z.enum(['y', 'z']), openAngle: z.number() }),
    z.object({ kind: z.literal('slide'), axis: z.enum(['x', 'y', 'z']), distance: z.number() }),
  ])).optional(),
})

// One shape per constraint type, so a constraint cannot miss the fields its
// type needs. Widening the set since v1 stays backward compatible.
const Id = z.string().min(1)
const ItemConstraintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapToAnchor'), target: Id, corner: z.number().int().min(0).max(3).optional(), point: Id.optional() }),
  z.object({ type: z.literal('snapToItem'), target: Id, point: Id, targetPoint: Id }),
  z.object({ type: z.literal('lockAxis'), axis: z.enum(['x', 'y', 'z']) }),
  z.object({ type: z.literal('mirrorPair'), target: Id, distance: z.number().positive().optional() }),
])
// `noOverlap` was declared by early v1 files but never had any effect: drop it.
const ConstraintsSchema = z.preprocess(
  (value) => Array.isArray(value)
    ? value.filter((constraint) => !(constraint && typeof constraint === 'object' && (constraint as { type?: unknown }).type === 'noOverlap'))
    : value,
  z.array(ItemConstraintSchema),
)

const PlacedItemSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string().min(1),
  position: Vec3Schema,
  rotation: EulerSchema,
  locked: z.boolean().optional(),
  mirrored: z.boolean().optional(),
  constraints: ConstraintsSchema.optional(),
})

const ConnectionSchema = z.object({
  sourceItemId: z.string().min(1),
  sourceConnectorId: z.string().min(1),
  sourcePointId: z.string().min(1),
  targetItemId: z.string().min(1),
  targetConnectorId: z.string().min(1),
  targetPointId: z.string().min(1),
  resolvedTransform: z.object({ position: Vec3Schema, rotation: EulerSchema }).optional(),
})

const ProjectMetadataSchema = z
  .object({
    name: z.string().optional(),
    customer: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .catchall(z.unknown())

export const ProjectDataSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  enclosure: EnclosureSchema,
  items: z.array(PlacedItemSchema),
  connections: z.array(ConnectionSchema).optional(),
  metadata: ProjectMetadataSchema.optional(),
}).superRefine((project, ctx) => {
  const ids = new Set<string>()
  project.items.forEach((item, index) => {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: 'Duplicate item id' })
    ids.add(item.id)
  })
  project.items.forEach((item, index) => {
    item.constraints?.forEach((constraint, constraintIndex) => {
      if ((constraint.type === 'snapToItem' || constraint.type === 'mirrorPair') && (!ids.has(constraint.target) || constraint.target === item.id)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'constraints', constraintIndex, 'target'], message: 'Unknown or self-referencing item constraint' })
      }
    })
  })
  const joints = new Set<string>()
  project.connections?.forEach((connection, index) => {
    if (!ids.has(connection.sourceItemId) || !ids.has(connection.targetItemId) || connection.sourceItemId === connection.targetItemId) {
      ctx.addIssue({ code: 'custom', path: ['connections', index], message: 'Unknown or self-referencing connection item' })
    }
    const key = JSON.stringify([JSON.stringify([connection.sourceItemId, connection.sourcePointId]), JSON.stringify([connection.targetItemId, connection.targetPointId])].sort())
    if (joints.has(key)) ctx.addIssue({ code: 'custom', path: ['connections', index], message: 'Duplicate connection' })
    joints.add(key)
  })
  const anchors = new Set<string>()
  project.enclosure.anchors?.forEach((anchor, index) => {
    if (anchors.has(anchor.id)) ctx.addIssue({ code: 'custom', path: ['enclosure', 'anchors', index, 'id'], message: 'Duplicate anchor id' })
    anchors.add(anchor.id)
  })
})

export type ProjectDataValidated = z.infer<typeof ProjectDataSchema>
