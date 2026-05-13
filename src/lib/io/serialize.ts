import type { CatalogItem, ProjectData } from '../types'
import { PROJECT_SCHEMA_VERSION } from '../types'
import { ProjectDataSchema } from './schema'
import { migrateProject, MigrationError } from './migrations'

export interface ProjectIssue {
  level: 'error' | 'warning'
  path: string
  message: string
}

export class ProjectParseError extends Error {
  issues: ProjectIssue[]
  constructor(message: string, issues: ProjectIssue[]) {
    super(message)
    this.issues = issues
    this.name = 'ProjectParseError'
  }
}

export interface ParseOptions {
  /** If provided, references to unknown catalog ids and anchor ids are reported as warnings. */
  catalog?: CatalogItem[]
}

export interface ParseResult {
  project: ProjectData
  warnings: ProjectIssue[]
}

export function serializeProject(p: ProjectData): string {
  return JSON.stringify({ ...p, version: PROJECT_SCHEMA_VERSION }, null, 2)
}

export function parseProject(raw: string | unknown, opts: ParseOptions = {}): ParseResult {
  const obj = typeof raw === 'string' ? safeJsonParse(raw) : raw

  let migrated: ProjectData
  try {
    migrated = migrateProject(obj)
  } catch (e) {
    if (e instanceof MigrationError) {
      throw new ProjectParseError(e.message, [
        { level: 'error', path: '$.version', message: e.message },
      ])
    }
    throw e
  }

  const result = ProjectDataSchema.safeParse(migrated)
  if (!result.success) {
    const issues = result.error.issues.map<ProjectIssue>((iss) => ({
      level: 'error',
      path: '$' + (iss.path.length ? '.' + iss.path.join('.') : ''),
      message: iss.message,
    }))
    throw new ProjectParseError('Project failed schema validation', issues)
  }

  const project = result.data as ProjectData
  const warnings = collectReferenceWarnings(project, opts.catalog)
  return { project, warnings }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (e) {
    throw new ProjectParseError('Project JSON is malformed', [
      { level: 'error', path: '$', message: (e as Error).message },
    ])
  }
}

function collectReferenceWarnings(p: ProjectData, catalog?: CatalogItem[]): ProjectIssue[] {
  const warnings: ProjectIssue[] = []
  const catalogIds = new Set(catalog?.map((c) => c.id) ?? [])
  const anchorIds = new Set(p.enclosure.anchors?.map((a) => a.id) ?? [])
  const itemIdSet = new Set<string>()

  p.items.forEach((it, idx) => {
    if (itemIdSet.has(it.id)) {
      warnings.push({
        level: 'warning',
        path: `$.items[${idx}].id`,
        message: `duplicate item id "${it.id}"`,
      })
    } else {
      itemIdSet.add(it.id)
    }

    if (catalog && !catalogIds.has(it.catalogId)) {
      warnings.push({
        level: 'warning',
        path: `$.items[${idx}].catalogId`,
        message: `catalog id "${it.catalogId}" not present in current catalog`,
      })
    }

    it.constraints?.forEach((c, ci) => {
      if (c.type === 'snapToAnchor' && c.target && !anchorIds.has(c.target)) {
        warnings.push({
          level: 'warning',
          path: `$.items[${idx}].constraints[${ci}].target`,
          message: `anchor "${c.target}" referenced but not defined in enclosure.anchors`,
        })
      }
    })
  })

  return warnings
}
