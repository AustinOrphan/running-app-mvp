import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useMe, useSetupStatus } from './api/auth.ts'
import { dropUserQueries, keys, UNAUTHORIZED_EVENT } from './api/client.ts'
import { Layout } from './components/Layout.tsx'
import { ActivitiesPage } from './pages/ActivitiesPage.tsx'
import { ActivityDetailPage } from './pages/ActivityDetailPage.tsx'
import { BriefPage } from './pages/BriefPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { FuelLabPage } from './pages/FuelLabPage.tsx'
import { GoalsPage } from './pages/GoalsPage.tsx'
import { IntegrationsPage } from './pages/IntegrationsPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MorePage } from './pages/MorePage.tsx'
import { PlanPage } from './pages/PlanPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { ResearchPage } from './pages/ResearchPage.tsx'
import { ReviewPage } from './pages/ReviewPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import { StatsPage } from './pages/StatsPage.tsx'
import { StrengthPage } from './pages/StrengthPage.tsx'
import { useOutboxReplay } from './pwa/outbox.ts'

/** Sends first-run visitors to /setup and signed-out visitors to /login. */
function AuthGate() {
  const queryClient = useQueryClient()
  const setup = useSetupStatus()
  const me = useMe()
  // Writes kept on this phone while offline go out whenever the app is open, once the queue has
  // been checked against the signed-in user; a 401 drops them.
  useOutboxReplay(me.data?.id ?? null)

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

  if (setup.isError || me.isError) {
    return <p role="alert">The server did not respond. Reload the page to try again.</p>
  }
  if (setup.isPending || me.isPending) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  if (setup.data.needsSetup) return <Navigate to="/setup" replace />
  if (me.data === null) return <Navigate to="/login" replace />
  return <Outlet />
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGate />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/brief" element={<BriefPage />} />
          <Route path="/brief/:weekStart" element={<BriefPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/fuel" element={<FuelLabPage />} />
          <Route path="/strength" element={<StrengthPage />} />
          <Route path="/more" element={<MorePage />} />
        </Route>
      </Route>
    </Routes>
  )
}
