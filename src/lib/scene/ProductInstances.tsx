import { useLayoutEffect, useRef, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Anchor, CatalogItem, PlacedItem } from '../types'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { prepareProductAsset, productAssetKey } from './productAsset'
import { AssetBoundary } from './AssetBoundary'
import { Item } from './Item'

/** One loader per used product; technical data is published before placed instances mount. */
export function ProductInstances({ catalog, items, anchors }: {
  catalog: CatalogItem
  items: PlacedItem[]
  anchors: Anchor[]
}) {
  const store = useConfiguratorStoreApi()
  const [startedAt] = useState(() => performance.now())
  const reported = useRef(false)
  const gltf = useGLTF(catalog.glbUrl)
  const asset = prepareProductAsset(gltf.scene, catalog)
  const ready = useConfiguratorStore((state) => !!state.itemSizes[catalog.id] &&
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
}
