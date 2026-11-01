// The sheets that open on a tap, loaded the first time one is opened instead of with the app. They
// hold forms and previews that most visits never open, and left in the entry chunk they took it
// past the 500 kB that `vite.config.ts` keeps it under. A mount site imports its sheet from here,
// not from the sheet's own file, and passes the props the sheet takes; the sheet files themselves
// are unchanged. Nothing else may import a sheet statically, or its code is back in the entry.
//
// Loading shows nothing: the code is a few kilobytes, `warmSheets` fetches it when the app is idle,
// and a sheet that is not there yet only delays the tap by the time of one request. When the code
// cannot be loaded at all (offline with no copy kept, or a release replaced the file) the sheet
// opens with a short notice instead of taking the page down with it.
import { lazy, Suspense, type ComponentType } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { Sheet } from './Sheet.tsx'

function Unavailable({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      open
      onClose={onClose}
      title={render(TEMPLATES['today.sheet.unavailable-title'], {}, 'km')}
    >
      <p role="alert">{render(TEMPLATES['today.sheet.unavailable'], {}, 'km')}</p>
    </Sheet>
  )
}

/** Every loader, so `warmSheets` can fetch them all. */
const loaders: Array<() => Promise<unknown>> = []

function lazySheet<P extends { onClose: () => void }>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  loaders.push(load)
  const Loaded = lazy(async () => {
    try {
      return { default: await load() }
    } catch {
      return { default: Unavailable as ComponentType<P> }
    }
  }) as unknown as ComponentType<P>
  return function LazySheet(props: P) {
    return (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    )
  }
}

export const CheckinSheet = lazySheet(() =>
  import('./today/CheckinSheet.tsx').then((module) => module.CheckinSheet),
)
export const DoneSheet = lazySheet(() =>
  import('./today/DoneSheet.tsx').then((module) => module.DoneSheet),
)
export const FuelLogSheet = lazySheet(() =>
  import('./fuel/FuelLogSheet.tsx').then((module) => module.FuelLogSheet),
)
export const StrengthSheet = lazySheet(() =>
  import('./strength/StrengthSheet.tsx').then((module) => module.StrengthSheet),
)
export const StrengthSetupSheet = lazySheet(() =>
  import('./strength/SetupSheets.tsx').then((module) => module.StrengthSetupSheet),
)
export const LoadSettingSheet = lazySheet(() =>
  import('./LoadSettingSheet.tsx').then((module) => module.LoadSettingSheet),
)
export const PlanShapeSheet = lazySheet(() =>
  import('./PlanShapeSheet.tsx').then((module) => module.PlanShapeSheet),
)
export const NotFullSheet = lazySheet(() =>
  import('./disruption/NotFullSheet.tsx').then((module) => module.NotFullSheet),
)
export const ReplanSheet = lazySheet(() =>
  import('./disruption/ReplanSheet.tsx').then((module) => module.ReplanSheet),
)
export const WindowActionSheet = lazySheet(() =>
  import('./disruption/WindowActionSheet.tsx').then((module) => module.WindowActionSheet),
)
export const RaceResultSheet = lazySheet(() =>
  import('../pages/RaceResultSheet.tsx').then((module) => module.RaceResultSheet),
)

/**
 * Fetches the code of every sheet once the app has been idle for a moment, so a tap finds it in
 * the browser's cache and a sheet opens offline too. Failures are left to the sheet itself.
 */
export function warmSheets(): void {
  const start = () => {
    for (const load of loaders) load().catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 5000 })
  } else {
    window.setTimeout(start, 3000)
  }
}
