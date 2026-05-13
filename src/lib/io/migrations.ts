import type { ProjectData } from '../types'
import { PROJECT_SCHEMA_VERSION } from '../types'

type RawProject = Record<string, unknown>
type Migration = (data: RawProject) => RawProject

// Each migration upgrades data FROM version N to N+1.
// Index = source version. migrations[0] takes a v0 doc and returns v1.
const migrations: Migration[] = [
  // v0 -> v1: ensure `items[].rotation` exists; older docs may have only position.
  (data) => {
    const items = Array.isArray(data.items) ? data.items : []
    return {
      ...data,
      version: 1,
      items: items.map((it) => {
        const i = it as Record<string, unknown>
        return { rotation: [0, 0, 0], ...i }
      }),
      enclosure: data.enclosure ?? { glbUrl: '' },
    }
  },
]

export class MigrationError extends Error {
  fromVersion: number
  toVersion: number
  constructor(from: number, to: number, cause?: unknown) {
    super(`Cannot migrate project from version ${from} to ${to}${cause ? `: ${String(cause)}` : ''}`)
    this.fromVersion = from
    this.toVersion = to
    this.name = 'MigrationError'
  }
}

/**
 * Upgrade a raw project to the current schema version, applying each
 * registered migration in sequence. Idempotent at current version.
 */
export function migrateProject(raw: unknown): ProjectData {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError(-1, PROJECT_SCHEMA_VERSION, 'project root is not an object')
  }
  let data = raw as RawProject
  const startVersion = typeof data.version === 'number' ? data.version : 0
  if (startVersion > PROJECT_SCHEMA_VERSION) {
    throw new MigrationError(
      startVersion,
      PROJECT_SCHEMA_VERSION,
      'project schema is newer than this library supports — upgrade the library',
    )
  }
  for (let v = startVersion; v < PROJECT_SCHEMA_VERSION; v++) {
    const m = migrations[v]
    if (!m) throw new MigrationError(v, v + 1, 'no migration registered')
    try {
      data = m(data)
    } catch (e) {
      throw new MigrationError(v, v + 1, e)
    }
  }
  return data as unknown as ProjectData
}
