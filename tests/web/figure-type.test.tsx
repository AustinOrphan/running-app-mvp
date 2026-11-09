import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  applyCondensedFigures,
  CONDENSED_FIGURES_ATTRIBUTE,
  CONDENSED_FIGURES_KEY,
  useCondensedFigures,
} from '../../web/components/figureType.ts'
import { Figure } from '../../web/components/Figure.tsx'

beforeEach(() => {
  localStorage.removeItem(CONDENSED_FIGURES_KEY)
})
afterEach(() => {
  applyCondensedFigures(false)
  localStorage.removeItem(CONDENSED_FIGURES_KEY)
})

describe('the Condensed figures switch', () => {
  test('is off by default and persists once set', () => {
    const first = renderHook(() => useCondensedFigures())
    expect(first.result.current.on).toBe(false)
    act(() => {
      first.result.current.setOn(true)
    })
    expect(localStorage.getItem(CONDENSED_FIGURES_KEY)).toBe('on')
    first.unmount()

    const second = renderHook(() => useCondensedFigures())
    expect(second.result.current.on).toBe(true)
    act(() => {
      second.result.current.setOn(false)
    })
    expect(localStorage.getItem(CONDENSED_FIGURES_KEY)).toBe('off')
  })

  test('sets the attribute on the root while on and removes it when off', () => {
    expect(document.documentElement.hasAttribute(CONDENSED_FIGURES_ATTRIBUTE)).toBe(false)
    applyCondensedFigures(true)
    expect(document.documentElement.getAttribute(CONDENSED_FIGURES_ATTRIBUTE)).toBe('on')
    applyCondensedFigures(false)
    expect(document.documentElement.hasAttribute(CONDENSED_FIGURES_ATTRIBUTE)).toBe(false)
  })
})

describe('the figure class', () => {
  test('marks the value of a lead figure and never its unit', () => {
    render(
      <dl>
        <Figure label="Distance" value="17.46" unit="mi" />
      </dl>,
    )
    expect(screen.getByText('17.46')).toHaveClass('figure-type')
    expect(screen.getByText('mi')).not.toHaveClass('figure-type')
  })
})
