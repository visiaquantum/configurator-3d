import type { ConfiguratorState } from './store'
import { validateConfiguration } from '../assembly/validation'
import { validationIssue } from '../assembly/messages'
import type { ValidationIssue } from '../types'
import { own } from '../util/record'

/** Readiness is separate from geometric validity: an unloaded model is not a valid assembly. */
export function configurationStatus(state: ConfiguratorState) {
  const fail = (message: string) => ({ ready: false, technical: false, message })
  if (!state.project) return fail('Nessun progetto')
  if (state.loadingCatalog || state.loadingManifest) return fail('Caricamento dati tecnici…')
  if (state.catalogError || state.manifestError) return fail(state.catalogError ?? state.manifestError!)
  const assetError = state.assetErrors.enclosure ?? state.project.items.map((item) => own(state.assetErrors, item.id) ?? own(state.assetErrors, `product:${item.catalogId}`)).find(Boolean)
  if (assetError) return fail(`Errore modello: ${assetError}`)
  if (state.project.items.some((item) => !Object.hasOwn(state.catalog, item.catalogId))) return fail('Prodotto assente dal catalogo')
  if (!state.captureRefs || !state.enclosureBBox || state.project.items.some((item) =>
    !own(state.itemSizes, item.catalogId) || !Object.hasOwn(state.itemSnaps, item.catalogId) || !state.itemRegistry.has(item.id),
  )) return fail('Caricamento modelli 3D…')
  const technical = !!state.assemblyManifest && state.project.items.every((item) =>
    state.assemblyManifest?.products.some((product) => product.catalogId === item.catalogId),
  )
  return { ready: true, technical, message: technical ? 'Dati tecnici caricati' : 'Validazione tecnica non disponibile' }
}

/** A fresh report for imperative callers, including loading and asset errors. */
export function validationForState(state: ConfiguratorState): ValidationIssue[] {
  const issues = validateConfiguration(state.project, state.catalog, state.assemblyManifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  })
  const status = configurationStatus(state)
  if (state.project && !status.ready) issues.unshift(validationIssue('error', 'incomplete-data', 'not-ready', [], { status: status.message }))
  return issues
}
