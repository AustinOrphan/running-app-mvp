import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import styles from './Layout.module.css'
import { Nav, restoreTheme } from './Nav.tsx'
import { Skeleton } from './Skeleton.tsx'
import { ToastProvider } from './Toast.tsx'

export { useTheme } from './Nav.tsx'

/** Tab bar below 720px, side rail from 720px, one `<main>`, a skip link and the toast host. */
export function Layout() {
  useEffect(() => {
    restoreTheme()
  }, [])

  return (
    <ToastProvider>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          <Suspense fallback={<Skeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </ToastProvider>
  )
}
