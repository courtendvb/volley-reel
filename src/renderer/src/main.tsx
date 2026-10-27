import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyAppearance, loadAppearance } from './appearance'
import './styles.css'

applyAppearance(loadAppearance(), false) // before the first paint, so a dark start doesn't flash light

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
