import './lang' // first: the interface language, before anything translates its text
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyAppearance, loadAppearance } from './appearance'
import './styles.css'
import { APP_NAME } from '../../shared/edition'

applyAppearance(loadAppearance(), false) // before the first paint, so a dark start doesn't flash light

document.title = APP_NAME // the internal edition's own name in the title bar
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
