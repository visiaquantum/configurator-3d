import type { ReactNode } from 'react'
import { ConfiguratorStoreContext } from './store'
import type { ConfiguratorStore } from './store'

export function ConfiguratorStoreProvider({ store, children }: { store: ConfiguratorStore; children: ReactNode }) {
  return <ConfiguratorStoreContext.Provider value={store}>{children}</ConfiguratorStoreContext.Provider>
}
