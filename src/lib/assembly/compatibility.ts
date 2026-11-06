import type { AssemblyManifest, ConnectorDefinition } from '../types'
import { definitionFor } from './manifest'

/** Why two products cannot be joined, from the manifest alone. */
export type ProductIncompatibility = 'not-in-manifest' | 'no-connectors' | 'incompatible-family'

export interface ProductCompatibility {
  compatible: boolean
  /** Connector pairs that accept each other: this product's, then the other's. */
  joints: Array<{ connector: string; otherConnector: string }>
  reason?: ProductIncompatibility
  /** Default (Italian) explanation. */
  message: string
}

const accepts = (a: ConnectorDefinition, b: ConnectorDefinition) =>
  (a.compatibleWith?.includes(b.id) ?? false) || (b.compatibleWith?.includes(a.id) ?? false)

/**
 * Whether two catalogue products can be joined somewhere, read off their
 * manifest connectors (`compatibleWith`, either direction). Point positions,
 * capacity and collisions are decided later, on the actual joint.
 */
export function productCompatibility(manifest: AssemblyManifest | null | undefined, catalogId: string, otherCatalogId: string): ProductCompatibility {
  const mine = definitionFor(manifest, catalogId)
  const theirs = definitionFor(manifest, otherCatalogId)
  if (!mine || !theirs) {
    return { compatible: false, joints: [], reason: 'not-in-manifest', message: `${!mine ? catalogId : otherCatalogId} non è descritto nel manifest` }
  }
  if (!mine.connectors.length || !theirs.connectors.length) {
    return { compatible: false, joints: [], reason: 'no-connectors', message: `${!mine.connectors.length ? catalogId : otherCatalogId} non ha punti di aggancio` }
  }
  const joints = mine.connectors.flatMap((connector) => theirs.connectors
    .filter((other) => accepts(connector, other))
    .map((other) => ({ connector: connector.id, otherConnector: other.id })))
  return joints.length
    ? { compatible: true, joints, message: 'Compatibile' }
    : { compatible: false, joints, reason: 'incompatible-family', message: 'Famiglie di aggancio non compatibili' }
}

/** Catalogue ids of the products `catalogId` can be joined to, manifest order. */
export function compatibleCatalogIds(manifest: AssemblyManifest | null | undefined, catalogId: string): string[] {
  return (manifest?.products ?? [])
    .filter((product) => productCompatibility(manifest, catalogId, product.catalogId).compatible)
    .map((product) => product.catalogId)
}
