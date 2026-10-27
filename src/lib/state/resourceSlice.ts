import type { Object3D } from 'three'
import { parseCatalog } from '../io/catalog'
import { resolvePendingJoints } from '../assembly/resolveJoints'
import { createItemRegistry } from '../scene/itemRegistry'
import { endAttachment } from './reset'
import { selectEffectiveAnchors } from './selectors'
import type { GetState, ResourceActions, SceneResources, SetState } from './storeTypes'

/**
 * Loaded technical data and live scene handles. A metadata change may resolve
 * pending joints in the same notification, but never adds history.
 */
export function createResourceSlice(set: SetState, get: GetState): SceneResources & ResourceActions {
  return {
    catalog: {},
    assemblyManifest: null,
    loadingCatalog: false,
    loadingManifest: false,
    catalogError: null,
    manifestError: null,
    itemSizes: {},
    itemSnaps: {},
    itemRules: {},
    runtimeAnchors: [],
    enclosureBBox: null,
    interiorBBox: null,
    assetErrors: {},
    itemRegistry: createItemRegistry(),
    captureRefs: null,
    telemetryListener: null,

    setCatalog: (items) => {
      const catalog = Object.fromEntries(parseCatalog(items).map((item) => [item.id, item]))
      const previous = get()
      if (JSON.stringify(previous.catalog) === JSON.stringify(catalog)) return
      // A changed product invalidates its hydrated metadata; the rest stays.
      const changed = new Set(Object.keys(previous.catalog).filter((id) =>
        JSON.stringify(previous.catalog[id]) !== JSON.stringify(catalog[id]),
      ))
      const keep = <T,>(values: Record<string, T>) => Object.fromEntries(
        Object.entries(values).filter(([id]) => !changed.has(id)),
      )
      set({ ...endAttachment(previous), catalog, itemRules: keep(previous.itemRules),
        itemSnaps: keep(previous.itemSnaps), itemSizes: keep(previous.itemSizes) })
    },

    addCatalogItem: (item) => {
      const current = get().catalog
      get().setCatalog([...Object.values(current).filter((entry) => entry.id !== item.id), item])
    },

    setAssemblyManifest: (manifest) => set((state) => ({
      ...endAttachment(state),
      assemblyManifest: manifest,
      project: resolvePendingJoints(state.project, { ...state, assemblyManifest: manifest }),
    })),

    hydrateProduct: (product, metadata) => set((state) => {
      // A suspended/obsolete load must not republish data from an old catalog.
      // Returning the same state object publishes nothing.
    if (state.catalog[product.id] !== product) return state
      const current = { size: state.itemSizes[product.id], snaps: state.itemSnaps[product.id], rules: state.itemRules[product.id] }
      if (JSON.stringify(current) === JSON.stringify(metadata)) return state
      const owned = structuredClone(metadata)
      const updates = {
        itemSizes: { ...state.itemSizes, [product.id]: owned.size },
        itemSnaps: { ...state.itemSnaps, [product.id]: owned.snaps },
        itemRules: { ...state.itemRules, [product.id]: owned.rules },
      }
      return { ...updates, project: resolvePendingJoints(state.project, { ...state, ...updates }) }
    }),

    setItemSize: (catalogId, size) => set((s) => ({ itemSizes: { ...s.itemSizes, [catalogId]: size } })),

    setItemRules: (catalogId, rules) => set((state) => {
      const itemRules = { ...state.itemRules, [catalogId]: rules }
      return { itemRules, project: resolvePendingJoints(state.project, { ...state, itemRules }) }
    }),

    setItemSnaps: (catalogId, snaps) => set((state) => {
      const itemSnaps = { ...state.itemSnaps, [catalogId]: snaps }
      return { itemSnaps, project: resolvePendingJoints(state.project, { ...state, itemSnaps }) }
    }),

    setAssetError: (id, error) => set((s) => {
      if ((s.assetErrors[id] ?? null) === error) return s
      const next = { ...s.assetErrors }
      if (error) next[id] = error
      else delete next[id]
      return { assetErrors: next }
    }),

    setRuntimeAnchors: (anchors) => set({ runtimeAnchors: anchors }),
    setEnclosureBBox: (b) => set({ enclosureBBox: b }),
    setInteriorBBox: (b) => set({ interiorBBox: b }),
    setCaptureRefs: (refs) => set({ captureRefs: refs }),
    setTelemetryListener: (listener) => set({ telemetryListener: listener }),
    reportTelemetry: (event) => {
      try { get().telemetryListener?.(event) } catch { /* Host instrumentation must not interrupt editing. */ }
    },

    collectExportRoots: () => {
      const refs = get().captureRefs
      if (!refs) return []
      const roots: Object3D[] = []
      refs.scene.traverse((obj) => {
        if (obj.userData?.exportable === true) roots.push(obj)
      })
      return roots
    },

    getEffectiveAnchors: () => selectEffectiveAnchors(get()),
  }
}
