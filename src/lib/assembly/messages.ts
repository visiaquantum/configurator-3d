import type { ValidationIssue } from '../types'

/** Stable identifier of each validation finding, for hosts that show their own text. */
export type ValidationReason =
  | 'manifest-missing'
  | 'bounds-missing'
  | 'not-in-catalog'
  | 'not-in-manifest'
  | 'mirror-pair-mismatch'
  | 'invalid-item-reference'
  | 'pending-joint'
  | 'connection-item-invalid'
  | 'connection-duplicate'
  | 'connector-missing'
  | 'snap-point-missing'
  | 'connectors-incompatible'
  | 'normals-not-opposed'
  | 'snaps-misaligned'
  | 'snap-point-occupied'
  | 'connection-cycle'
  | 'collision'
  | 'out-of-bounds'
  | 'not-ready'

/** Values a message interpolates; also exposed on the issue for translation. */
export interface ValidationParams {
  catalogId?: string
  otherCatalogId?: string
  /** Snap misalignment in millimetres. */
  distanceMm?: number
  /** Readiness explanation, for `not-ready`. */
  status?: string
}

/** Default (Italian) text for each reason. */
export const VALIDATION_MESSAGES_IT: Record<ValidationReason, (params: ValidationParams) => string> = {
  'manifest-missing': () => 'Manifest tecnico assente: verifica dei connettori non disponibile',
  'bounds-missing': () => 'Limiti interni del vano non disponibili: ingombro da verificare',
  'not-in-catalog': (p) => `Prodotto ${p.catalogId} non presente nel catalogo corrente`,
  'not-in-manifest': (p) => `Prodotto ${p.catalogId} assente dal manifest tecnico`,
  'mirror-pair-mismatch': () => 'Coppia specchiata non reciproca o incoerente',
  'invalid-item-reference': () => 'Vincolo con item non valido',
  'pending-joint': () => 'Collegamento non riconosciuto dal manifest tecnico',
  'connection-item-invalid': () => 'Connessione con item non valido',
  'connection-duplicate': () => 'Connessione duplicata',
  'connector-missing': () => 'Connettore assente dal manifest',
  'snap-point-missing': () => 'Punto di snap assente o non caricato',
  'connectors-incompatible': () => 'Connettori non compatibili',
  'normals-not-opposed': () => 'Normali dei connettori non opposte',
  'snaps-misaligned': (p) => `Snap non allineati (${(p.distanceMm ?? 0).toFixed(1)} mm)`,
  'snap-point-occupied': () => 'Punto di snap già occupato',
  'connection-cycle': () => 'Connessioni cicliche non consentite',
  'collision': (p) => `Collisione non consentita tra ${p.catalogId} e ${p.otherCatalogId}`,
  'out-of-bounds': (p) => `Prodotto ${p.catalogId} fuori dal vano`,
  'not-ready': (p) => p.status ?? 'Dati non ancora pronti',
}

/** Build an issue whose `message` is the default text for `reason`. */
export function validationIssue(
  level: ValidationIssue['level'],
  code: ValidationIssue['code'],
  reason: ValidationReason,
  itemIds: string[],
  params: ValidationParams = {},
): ValidationIssue {
  return { level, code, reason, message: VALIDATION_MESSAGES_IT[reason](params), itemIds, ...(Object.keys(params).length ? { params } : {}) }
}
