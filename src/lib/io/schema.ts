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
  dimensions: Vec3Schema.optional(),
  anchors: z.array(AnchorSchema).optional(),
})

// `snapToItem` was added after v1. Widening an enum is backward compatible —
// every existing v1 document still validates — so no schema version bump.
const ItemConstraintSchema = z.object({
  type: z.enum(['snapToAnchor', 'snapToItem', 'lockAxis', 'noOverlap', 'mirrorPair']),
  target: z.string().optional(),
  axis: z.enum(['x', 'y', 'z']).optional(),
  distance: z.number().optional(),
  corner: z.number().int().min(0).max(3).optional(),
  point: z.string().optional(),
  targetPoint: z.string().optional(),
})

const PlacedItemSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string().min(1),
  position: Vec3Schema,
  rotation: EulerSchema,
  locked: z.boolean().optional(),
  mirrored: z.boolean().optional(),
  constraints: z.array(ItemConstraintSchema).optional(),
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
  version: z.number().int().nonnegative(),
  enclosure: EnclosureSchema,
  items: z.array(PlacedItemSchema),
  connections: z.array(ConnectionSchema).optional(),
  metadata: ProjectMetadataSchema.optional(),
})

export type ProjectDataValidated = z.infer<typeof ProjectDataSchema>
