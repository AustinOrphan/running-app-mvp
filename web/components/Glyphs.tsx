// Small 16 px stroke glyphs for states that must not rest on colour alone. Decorative: the words
// beside them carry the meaning, so they are hidden from assistive technology.
import type { SVGProps } from 'react'

function Glyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
      {...props}
    />
  )
}

/** The mark on a destructive button (visual design 11: secondary, trash glyph, confirm sheet). */
export function TrashGlyph() {
  return (
    <Glyph>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M9 7V4h6v3" />
    </Glyph>
  )
}

/** The mark before a message that needs attention (visual design 11: ochre edge, glyph, words). */
export function AlertGlyph() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </Glyph>
  )
}
