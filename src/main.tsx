import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ConfiguratorStoreProvider, createConfiguratorStore } from './lib'

const store = createConfiguratorStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfiguratorStoreProvider store={store}><App /></ConfiguratorStoreProvider>
  </StrictMode>,
)
