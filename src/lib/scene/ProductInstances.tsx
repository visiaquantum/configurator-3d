import { memo, useLayoutEffect, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Anchor, CatalogItem, PlacedItem } from '../types'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { prepareProductAsset, productAssetKey } from './productAsset'
import { AssetBoundary } from './AssetBoundary'
import { Item } from './Item'
import { own } from '../util/record'

// When each product's load was first requested. Component state cannot hold
// it: `useGLTF` suspends the first render, and React discards that state.
const loadRequestedAt = new WeakMap<CatalogItem, number>()

/** One loader per used product; technical data is published before placed instances mount. */
export const ProductInstances = memo(function ProductInstances({ catalog, items, anchors }: {
  catalog: CatalogItem
  items: PlacedItem[]
  anchors: Anchor[]
}) {
  const store = useConfiguratorStoreApi()
  if (!loadRequestedAt.has(catalog)) loadRequestedAt.set(catalog, performance.now())
  const startedAt = loadRequestedAt.get(catalog)!
  const reported = useRef(false)
  const gltf = useGLTF(catalog.glbUrl)
  const asset = prepareProductAsset(gltf.scene, catalog)
  const ready = useConfiguratorStore((state) => !!own(state.itemSizes, catalog.id) &&
    Object.hasOwn(state.itemSnaps, catalog.id) && Object.hasOwn(state.itemRules, catalog.id))

  useLayoutEffect(() => {
    store.getState().hydrateProduct(catalog, asset.metadata)
    if (!reported.current) {
      reported.current = true
      store.getState().reportTelemetry({ type: 'asset-load', outcome: 'success',
        durationMs: performance.now() - startedAt, detail: { catalogId: catalog.id } })
    }
  }, [store, catalog, asset, startedAt])

  if (!ready) return null
  return items.map((item) => <AssetBoundary key={item.id} id={item.id} source={productAssetKey(catalog)}>
    <Item item={item} asset={asset} anchors={anchors} />
  </AssetBoundary>)
})
