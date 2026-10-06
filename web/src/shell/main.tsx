import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../compartido/fuentes'
import './shell.css'
import { Shell } from './Shell'

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
