import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StlToGlb } from './StlToGlb'
import './stlToGlb.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StlToGlb />
  </StrictMode>,
)
