import '@fontsource-variable/libre-franklin'
import '@fontsource-variable/source-serif-4'
import './styles/tokens.css'
import './styles/global.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App, preloadRoute } from './App.tsx'
import { createQueryClient } from './api/client.ts'
import { warmSheets } from './components/lazySheets.tsx'
import { registerServiceWorker, reloadOnPreloadError } from './pwa/register.ts'

// A release replaces the hashed files; a page that is still open on the old build asks for one that
// is gone, and reloads once to get the new build (the worker keeps the old build's files too).
reloadOnPreloadError()

// The page's code downloads while the app asks the server who is signed in.
preloadRoute(window.location.pathname)

const queryClient = createQueryClient()
const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
// The sheets wait until the page has the connection to itself: on a phone link, fetching their
// forty files at once delays the code and the data of the page being opened.
window.setTimeout(warmSheets, 3000)
// The offline shell: a production build only (ADR 0012).
registerServiceWorker()
