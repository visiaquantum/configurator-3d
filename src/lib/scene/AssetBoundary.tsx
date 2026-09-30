import { Component, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Html } from '@react-three/drei'
import { useConfiguratorStoreApi } from '../state/store'

class ModelBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message)
  }

  render() {
    if (this.state.error) return <Html center><div role="alert" style={{ color: '#ff9090', background: '#182030', padding: 12, width: 220 }}>Impossibile caricare il modello 3D.</div></Html>
    return this.props.children
  }
}

export function AssetBoundary({ id, source, children }: { id: string; source: string; children: ReactNode }) {
  const store = useConfiguratorStoreApi()
  useEffect(() => {
    return () => store.getState().setAssetError(id, null)
  }, [id, source, store])
  return <ModelBoundary key={source} onError={(message) => store.getState().setAssetError(id, message)}>{children}</ModelBoundary>
}
