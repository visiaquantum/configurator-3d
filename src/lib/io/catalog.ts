import { z } from 'zod'
import type { CatalogItem } from '../types'

export const CATALOG_SCHEMA_VERSION = 1

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const CatalogItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  glbUrl: z.string().min(1),
  size: Vec3Schema.optional(),
})

const CatalogMetadataSchema = z
  .object({
    name: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .catchall(z.unknown())

// Wrapper form: { version, items, metadata? }. Used for versioned external files.
const CatalogDataSchema = z.object({
  version: z.number().int().nonnegative(),
  items: z.array(CatalogItemSchema),
  metadata: CatalogMetadataSchema.optional(),
})

// Bare array form: [...items]. Accepted for convenience.
const CatalogArraySchema = z.array(CatalogItemSchema)

export interface CatalogIssue {
  level: 'error' | 'warning'
  path: string
  message: string
}

export class CatalogParseError extends Error {
  issues: CatalogIssue[]
  constructor(message: string, issues: CatalogIssue[]) {
    super(message)
    this.name = 'CatalogParseError'
    this.issues = issues
  }
}

/**
 * Parse a catalog JSON payload. Accepts either:
 *   - bare array:    [{ id, label, glbUrl, size? }, ...]
 *   - wrapped form:  { version, items: [...], metadata? }
 *
 * Returns a normalized CatalogItem[].
 */
export function parseCatalog(raw: string | unknown): CatalogItem[] {
  const obj = typeof raw === 'string' ? safeJsonParse(raw) : raw

  // Pick schema by shape of input so errors come from the form the caller
  // actually used. Array → bare; object → wrapped.
  const isArray = Array.isArray(obj)
  const schema = isArray ? CatalogArraySchema : CatalogDataSchema
  const result = schema.safeParse(obj)
  if (result.success) {
    return (isArray ? result.data : (result.data as { items: CatalogItem[] }).items) as CatalogItem[]
  }

  const issues = result.error.issues.map<CatalogIssue>((iss) => ({
    level: 'error',
    path: '$' + (iss.path.length ? '.' + iss.path.join('.') : ''),
    message: iss.message,
  }))
  throw new CatalogParseError('Catalog failed schema validation', issues)
}

/**
 * Resolve a catalog source to a CatalogItem[]. Accepts an array directly,
 * or a URL string to fetch + parse.
 */
export async function loadCatalog(source: CatalogItem[] | string): Promise<CatalogItem[]> {
  if (Array.isArray(source)) return source
  const res = await fetch(source)
  if (!res.ok) {
    throw new CatalogParseError(`Catalog fetch failed: ${res.status} ${res.statusText}`, [
      { level: 'error', path: '$', message: `HTTP ${res.status}` },
    ])
  }
  const text = await res.text()
  return parseCatalog(text)
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (e) {
    throw new CatalogParseError('Catalog JSON is malformed', [
      { level: 'error', path: '$', message: (e as Error).message },
    ])
  }
}

export { CatalogDataSchema, CatalogItemSchema }
