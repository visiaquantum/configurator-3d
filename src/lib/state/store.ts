import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createProjectSlice } from './projectSlice'
import { createResourceSlice } from './resourceSlice'
import { createInteractionSlice } from './interactionSlice'
import type { ConfiguratorState } from './storeTypes'

export type {
  CameraPreset,
  CameraProjection,
  CaptureRefs,
  ConfiguratorState,
  DragClearance,
  EnclosureBBox,
  GizmoMode,
} from './storeTypes'

/**
 * One store per configurator, composed from three slices: the persistent
 * project and its history (`projectSlice`), loaded resources and scene handles
 * (`resourceSlice`), and the current interaction with its derived caches
 * (`interactionSlice`). They share one state so a command updates all three
 * in a single notification.
 */
export const createConfiguratorStore = () => createStore<ConfiguratorState>((set, get) => ({
  ...createProjectSlice(set, get),
  ...createResourceSlice(set, get),
  ...createInteractionSlice(set, get),
}))

export type ConfiguratorStore = ReturnType<typeof createConfiguratorStore>
export const ConfiguratorStoreContext = createContext<ConfiguratorStore | null>(null)

/**
 * The store of the enclosing `ConfiguratorStoreProvider` (every `Configurator3D`
 * provides one). There is no global fallback: with several configurators on a
 * page, a silent shared store would mix their state.
 */
export function useConfiguratorStoreApi(): ConfiguratorStore {
  const store = useContext(ConfiguratorStoreContext)
  if (!store) throw new Error('useConfiguratorStore va usato dentro ConfiguratorStoreProvider o Configurator3D')
  return store
}

/** Select from the enclosing configurator's store. */
export function useConfiguratorStore<T>(selector: (state: ConfiguratorState) => T): T {
  return useStore(useConfiguratorStoreApi(), selector)
}
