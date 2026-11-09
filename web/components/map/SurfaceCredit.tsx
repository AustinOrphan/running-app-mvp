import { SURFACE_COPYRIGHT_URL, SURFACE_CREDIT } from '../../../shared/copy/surface.ts'

/** The OpenStreetMap credit, as a link to the licence, wherever the shares or their data show. */
export function SurfaceCredit({ className }: { className?: string }) {
  return (
    <a
      {...(className === undefined ? {} : { className })}
      href={SURFACE_COPYRIGHT_URL}
      target="_blank"
      rel="noreferrer"
    >
      {SURFACE_CREDIT}
    </a>
  )
}
