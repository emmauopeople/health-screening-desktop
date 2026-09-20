import '@renderer/styles/main.css'
import '@renderer/styles/responsive.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
