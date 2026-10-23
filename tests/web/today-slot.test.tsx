import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { SLOT_BUDGETS_PX, type SlotName } from '../../web/components/today/slots.ts'
import { renderWithProviders } from './helpers.tsx'

// A slot with an epic's mount reads the Today payload from the query cache, so it renders inside
// the providers; with nothing loaded it still renders nothing.
const render = renderWithProviders

const NAMES = Object.keys(SLOT_BUDGETS_PX) as SlotName[]

describe('slot budgets', () => {
  test('are the contract the owning epics build to', () => {
    expect(SLOT_BUDGETS_PX).toEqual({
      disruption: 64,
      fuel: 26,
      watch: 24,
      brief: 52,
      fuelPrompt: null,
    })
  })
})

describe('TodaySlot', () => {
  test.each(NAMES)('%s: with no content it renders nothing, so it has no height', (name) => {
    const { container } = render(<TodaySlot name={name} />)
    expect(container).toBeEmptyDOMElement()
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ['an empty string', ''],
    ['an empty list', []],
  ])('renders nothing for %s children', (_label, children) => {
    const { container } = render(<TodaySlot name="brief">{children}</TodaySlot>)
    expect(container).toBeEmptyDOMElement()
  })

  test.each(NAMES.filter((name) => SLOT_BUDGETS_PX[name] !== null))(
    '%s: content renders inside a wrapper that carries the slot name and budget',
    (name) => {
      render(
        <TodaySlot name={name}>
          <p>Slot content</p>
        </TodaySlot>,
      )
      const wrapper = screen.getByText('Slot content').closest('[data-slot]')
      expect(wrapper).not.toBeNull()
      expect(wrapper).toHaveAttribute('data-slot', name)
      expect(wrapper).toHaveAttribute('data-budget-px', String(SLOT_BUDGETS_PX[name]))
    },
  )

  test('an unbudgeted slot has no budget attribute', () => {
    render(
      <TodaySlot name="fuelPrompt">
        <p>Fuel prompt</p>
      </TodaySlot>,
    )
    const wrapper = screen.getByText('Fuel prompt').closest('[data-slot]')
    expect(wrapper).toHaveAttribute('data-slot', 'fuelPrompt')
    expect(wrapper).not.toHaveAttribute('data-budget-px')
  })
})
