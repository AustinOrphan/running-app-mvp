import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQueuedSentToasts } from '../api/activityOutbox.ts'
import { notePagePath } from '../pwa/pageTrail.ts'
import { PageBoundary } from './ErrorBoundary.tsx'
import styles from './Layout.module.css'
import { Nav, restoreTheme } from './Nav.tsx'
import { Skeleton } from './Skeleton.tsx'
import { ToastProvider } from './Toast.tsx'

export { useTheme } from './Nav.tsx'

/** Announces, as a toast, a run or rating that waited on the phone and has gone up. */
function QueuedSentToasts() {
  useQueuedSentToasts()
  return null
}

/** Tab bar below 720px, side rail from 720px, one `<main>`, a skip link and the toast host. */
export function Layout() {
  const { pathname } = useLocation()
  // Kept for the feedback note in Settings: the page the runner came from.
  useEffect(() => {
    notePagePath(pathname)
  }, [pathname])
  useEffect(() => {
    restoreTheme()
  }, [])

  return (
    <ToastProvider>
      <QueuedSentToasts />
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          {/* A page that throws is replaced here, so the navigation beside it stays usable. */}
          <PageBoundary>
            <Suspense fallback={<Skeleton />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        </div>
      </main>
    </ToastProvider>
  )
}
