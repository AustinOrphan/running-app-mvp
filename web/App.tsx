import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useEffect, useLayoutEffect } from 'react'
import { matchPath, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useMe, useSetupStatus } from './api/auth.ts'
import { useBrowserDefaults } from './api/browserDefaults.ts'
import { dropUserQueries, keys, UNAUTHORIZED_EVENT } from './api/client.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ErrorState } from './components/ErrorState.tsx'
import { applyCondensedFigures, useCondensedFigures } from './components/figureType.ts'
import { Layout } from './components/Layout.tsx'
import { useLoadView } from './components/loadView.ts'
import { Skeleton } from './components/Skeleton.tsx'
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
import { useOutboxReplay } from './pwa/outbox.ts'
import styles from './App.module.css'
import { lazyPage, warmPages, type Page } from './lazyPage.tsx'

const setupPage = lazyPage(() => import('./pages/SetupPage.tsx').then((m) => m.SetupPage))
const loginPage = lazyPage(() => import('./pages/LoginPage.tsx').then((m) => m.LoginPage))
const dashboardPage = lazyPage(() =>
  import('./pages/DashboardPage.tsx').then((m) => m.DashboardPage),
)
const activitiesPage = lazyPage(() =>
  import('./pages/ActivitiesPage.tsx').then((m) => m.ActivitiesPage),
)
const activityPage = lazyPage(() =>
  import('./pages/ActivityDetailPage.tsx').then((m) => m.ActivityDetailPage),
)
const planPage = lazyPage(() => import('./pages/PlanPage.tsx').then((m) => m.PlanPage))
const reviewPage = lazyPage(() => import('./pages/ReviewPage.tsx').then((m) => m.ReviewPage))
const briefPage = lazyPage(() => import('./pages/BriefPage.tsx').then((m) => m.BriefPage))
const goalsPage = lazyPage(() => import('./pages/GoalsPage.tsx').then((m) => m.GoalsPage))
const pacesPage = lazyPage(() => import('./pages/MyPacesPage.tsx').then((m) => m.MyPacesPage))
const planInputsPage = lazyPage(() =>
  import('./pages/PlanInputsPage.tsx').then((m) => m.PlanInputsPage),
)
const statsPage = lazyPage(() => import('./pages/StatsPage.tsx').then((m) => m.StatsPage))
const trendsPage = lazyPage(() => import('./pages/TrendsPage.tsx').then((m) => m.TrendsPage))
const settingsPage = lazyPage(() => import('./pages/SettingsPage.tsx').then((m) => m.SettingsPage))
const integrationsPage = lazyPage(() =>
  import('./pages/IntegrationsPage.tsx').then((m) => m.IntegrationsPage),
)
const profilePage = lazyPage(() => import('./pages/ProfilePage.tsx').then((m) => m.ProfilePage))
const researchPage = lazyPage(() => import('./pages/ResearchPage.tsx').then((m) => m.ResearchPage))
const fuelPage = lazyPage(() => import('./pages/FuelLabPage.tsx').then((m) => m.FuelLabPage))
const strengthPage = lazyPage(() => import('./pages/StrengthPage.tsx').then((m) => m.StrengthPage))
const racePage = lazyPage(() => import('./pages/RacePage.tsx').then((m) => m.RacePage))
const warningSignsPage = lazyPage(() =>
  import('./pages/WarningSignsPage.tsx').then((m) => m.WarningSignsPage),
)
const morePage = lazyPage(() => import('./pages/MorePage.tsx').then((m) => m.MorePage))

/** The pages outside the sign-in gate. */
const PUBLIC_ROUTES: ReadonlyArray<readonly [path: string, page: Page]> = [
  ['/setup', setupPage],
  ['/login', loginPage],
]

/** The pages behind the gate, inside the layout. */
const APP_ROUTES: ReadonlyArray<readonly [path: string, page: Page]> = [
  ['/', dashboardPage],
  ['/activities', activitiesPage],
  ['/activities/:id', activityPage],
  ['/plan', planPage],
  ['/review', reviewPage],
  ['/brief', briefPage],
  ['/brief/:weekStart', briefPage],
  ['/goals', goalsPage],
  ['/paces', pacesPage],
  ['/plan-inputs', planInputsPage],
  ['/stats', statsPage],
  ['/trends', trendsPage],
  ['/settings', settingsPage],
  ['/integrations', integrationsPage],
  ['/profile', profilePage],
  ['/research', researchPage],
  ['/warning-signs', warningSignsPage],
  ['/fuel', fuelPage],
  ['/strength', strengthPage],
  ['/race', racePage],
  ['/more', morePage],
]

/** The pages the tab bar and the side rail open most: fetched once the app is idle. */
export function warmTabRoutes(): void {
  warmPages([
    dashboardPage,
    activitiesPage,
    planPage,
    reviewPage,
    morePage,
    trendsPage,
    settingsPage,
  ])
}

/**
 * Starts fetching the code of the page for `pathname` at once. The entry calls it before React
 * renders: the page's code then downloads while the app asks the server who is signed in, instead
 * of after that answer. A path that matches no route does nothing, and a failed fetch is left to
 * the route itself.
 */
export function preloadRoute(pathname: string): void {
  const route = [...PUBLIC_ROUTES, ...APP_ROUTES].find(([path]) => matchPath(path, pathname))
  route?.[1].load().catch(() => {})
}

/** Sends first-run visitors to /setup and signed-out visitors to /login. */
function AuthGate() {
  const queryClient = useQueryClient()
  const setup = useSetupStatus()
  const me = useMe()
  // Writes kept on this phone while offline go out whenever the app is open, once the queue has
  // been checked against the signed-in user; a 401 drops them.
  useOutboxReplay(me.data?.id ?? null)
  // An account made by `create-user` without units or a zone takes them from this browser, once.
  useBrowserDefaults(me.data)
  // One view for the two reads the gate waits on: it fails when either has failed without data.
  const view = useLoadView({
    data: setup.data !== undefined && me.data !== undefined ? true : undefined,
    isError: (setup.isError && setup.data === undefined) || (me.isError && me.data === undefined),
    isFetching: setup.isFetching || me.isFetching,
  })

  useEffect(() => {
    function onUnauthorized() {
      queryClient.setQueryData([keys.me], null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    }
  }, [queryClient])

  // No session: what the page holds of the last one goes too, so the next account that signs in on
  // this tab is not shown the previous one's Today while its own loads. This runs once the gate
  // has sent the pages away, not in the 401 handler: a query that is removed under a page that is
  // still mounted is made again by that page, which asks the server again and meets another 401.
  const signedOut = me.data === null
  useEffect(() => {
    if (signedOut) dropUserQueries(queryClient)
  }, [signedOut, queryClient])

  if (view === 'failed' || view === 'retrying') {
    return (
      <div className={styles.gate}>
        <ErrorState
          subject="The app"
          onRetry={() => Promise.all([setup.refetch(), me.refetch()])}
          retrying={view === 'retrying'}
        />
      </div>
    )
  }
  if (setup.data === undefined || me.data === undefined) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  if (setup.data.needsSetup) return <Navigate to="/setup" replace />
  if (me.data === null) return <Navigate to="/login" replace />
  // A temporary password asks for its replacement before anything else is shown.
  if (me.data.mustChangePassword) return <ChangePasswordPage />
  return <Outlet />
}

export function App() {
  const condensed = useCondensedFigures()
  // before paint, so a page does not show the serif figures for a frame
  useLayoutEffect(() => {
    applyCondensedFigures(condensed.on)
  }, [condensed.on])
  return (
    <ErrorBoundary scope="app">
      <Suspense fallback={<Skeleton />}>
        <Routes>
          {PUBLIC_ROUTES.map(([path, { Component }]) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route element={<AuthGate />}>
            <Route element={<Layout />}>
              {APP_ROUTES.map(([path, { Component }]) => (
                <Route key={path} path={path} element={<Component />} />
              ))}
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
