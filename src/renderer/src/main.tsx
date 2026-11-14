import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter-tight'
import '@fontsource/instrument-serif/400-italic.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/screens.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
