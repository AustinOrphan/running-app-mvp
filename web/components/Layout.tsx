import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import styles from './Layout.module.css'
import { Nav, restoreTheme } from './Nav.tsx'
import { ToastProvider } from './Toast.tsx'

export { useTheme } from './Nav.tsx'

/** Tab bar below 900px, side rail above, one `<main>`, a skip link and the toast host. */
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
          <Outlet />
        </div>
      </main>
    </ToastProvider>
  )
}
