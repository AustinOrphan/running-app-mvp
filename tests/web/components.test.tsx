import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Button } from '../../web/components/Button.tsx'
import { EmptyState } from '../../web/components/EmptyState.tsx'
import { Field, Input } from '../../web/components/Field.tsx'
import { Meter } from '../../web/components/Meter.tsx'
import { PageHeader } from '../../web/components/PageHeader.tsx'
import { Segmented } from '../../web/components/Segmented.tsx'
import { Sheet } from '../../web/components/Sheet.tsx'
import { Skeleton } from '../../web/components/Skeleton.tsx'
import { ToastProvider, useToast } from '../../web/components/Toast.tsx'
import {
  formatClimb,
  formatLongDate,
  formatShortDate,
  formatWeekday,
  phaseLabel,
} from '../../web/components/format.ts'
import { expectCleanCopy } from './helpers.tsx'

afterEach(() => {
  vi.useRealTimers()
})

describe('Meter', () => {
  test('under target: words, not colour, carry the state', () => {
    render(<Meter valueMin={186} targetMin={450} label="Run time this week" />)
    const meter = screen.getByRole('meter', { name: 'Run time this week' })
    expect(meter).toHaveAttribute('aria-valuenow', '186')
    expect(meter).toHaveAttribute('aria-valuemax', '450')
    expect(meter).toHaveAttribute('aria-valuetext', '3.1 of 7.5 hours')
    expect(screen.getByText('3.1 h of 7.5 h target')).toBeInTheDocument()
    expect(meter).toHaveAttribute('data-state', 'under')
  })

  test('near target from 85% up to the target', () => {
    render(<Meter valueMin={384} targetMin={450} label="Run time" />)
    expect(screen.getByText('1.1 h to target')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute('data-state', 'near')
  })

  test('past the target is stated neutrally', () => {
    render(<Meter valueMin={474} targetMin={450} label="Run time" />)
    expect(screen.getByText('0.4 h past target')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute('data-state', 'over')
  })

  test('a target of 0 renders without NaN or Infinity', () => {
    const { container } = render(<Meter valueMin={0} targetMin={0} label="Run time" />)
    expect(screen.getByRole('meter')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('Button', () => {
  test('loading disables and sets aria-busy; variants render', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: /Save/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()

    for (const variant of ['primary', 'secondary', 'quiet', 'danger'] as const) {
      rerender(<Button variant={variant}>Go {variant}</Button>)
      const b = screen.getByRole('button', { name: `Go ${variant}` })
      expect(b).toBeEnabled()
      expect(b).not.toHaveAttribute('aria-busy')
      expect(b).toHaveAttribute('type', 'button')
    }
  })
})

describe('Field', () => {
  test('connects label, hint and error; the error replaces the hint', () => {
    const { rerender } = render(
      <Field label="Duration" hint="Minutes, like 45">
        {(a) => <Input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Duration')
    expect(input).not.toHaveAttribute('aria-invalid')
    const hint = screen.getByText('Minutes, like 45')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)

    rerender(
      <Field label="Duration" hint="Minutes, like 45" error="Enter minutes like 45, or 0:45:00">
        {(a) => <Input {...a} />}
      </Field>,
    )
    const invalid = screen.getByLabelText('Duration')
    expect(invalid).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Minutes, like 45')).not.toBeInTheDocument()
    const error = screen.getByText('Enter minutes like 45, or 0:45:00')
    expect(invalid.getAttribute('aria-describedby')).toBe(error.id)
  })

  test('an empty error string keeps the hint and does not mark the control invalid', () => {
    render(
      <Field label="Duration" hint="Minutes, like 45" error="">
        {(a) => <Input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Duration')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Minutes, like 45').id)
  })

  test('without hint or error there is no description', () => {
    render(<Field label="Notes">{(a) => <Input {...a} />}</Field>)
    expect(screen.getByLabelText('Notes')).not.toHaveAttribute('aria-describedby')
  })
})

describe('Segmented', () => {
  function Harness() {
    const [value, setValue] = useState<'run' | 'strength' | 'cross'>('run')
    return (
      <Segmented
        label="Type"
        value={value}
        onChange={setValue}
        options={[
          { value: 'run', label: 'Run' },
          { value: 'strength', label: 'Strength' },
          { value: 'cross', label: 'Cross' },
        ]}
      />
    )
  }

  test('one tab stop; arrow keys move and select', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>before</button>
        <Harness />
        <button>after</button>
      </>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Type' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveAttribute('aria-checked', 'true')

    await user.tab()
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Strength' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Strength' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveAttribute('aria-checked', 'false')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Cross' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })
})

describe('Sheet', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button
          onClick={() => {
            setOpen(true)
          }}
        >
          Open sheet
        </button>
        <Sheet
          open={open}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          title="Log activity"
          footer={<button>Save run</button>}
        >
          <input aria-label="Minutes" />
        </Sheet>
      </>
    )
  }

  test('role dialog, Escape closes, focus returns to the opener', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const opener = screen.getByRole('button', { name: 'Open sheet' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Log activity' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  test('scrim click closes; clicks inside do not', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    await user.click(screen.getByLabelText('Minutes'))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('sheet-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('Tab stays inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  test('Tab returns to the dialog when focus has fallen to the page behind it', async () => {
    const user = userEvent.setup()
    render(<Harness onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    const dialog = screen.getByRole('dialog')

    // The focused control unmounting or becoming disabled leaves focus on <body>.
    ;(document.activeElement as HTMLElement).blur()
    expect(document.body).toHaveFocus()
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    ;(document.activeElement as HTMLElement).blur()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save run' })).toHaveFocus()
  })
})

describe('Toast', () => {
  function Trigger({ onUndo }: { onUndo: () => void }) {
    const toast = useToast()
    return (
      <button
        onClick={() => {
          toast.show('Run saved', { action: { label: 'Undo', onClick: onUndo } })
        }}
      >
        Save
      </button>
    )
  }

  test('role status, hides after 4000 ms', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger onUndo={() => {}} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(within(screen.getByRole('status')).getByText('Run saved')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3900)
    })
    expect(screen.getByText('Run saved')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByText('Run saved')).not.toBeInTheDocument()
  })

  test('the action button fires and dismisses the toast', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Run saved')).not.toBeInTheDocument()
  })

  test('useToast outside a provider is a harmless no-op', () => {
    render(<Trigger onUndo={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText('Run saved')).not.toBeInTheDocument()
  })
})

describe('Skeleton', () => {
  test('shows nothing before 300 ms and its block after', () => {
    vi.useFakeTimers()
    const { container } = render(<Skeleton lines={3} />)
    expect(container).toBeEmptyDOMElement()
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(container).toBeEmptyDOMElement()
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.skeleton')).toHaveLength(3)
  })
})

describe('EmptyState and PageHeader', () => {
  test('EmptyState renders title, body and action', () => {
    render(
      <EmptyState
        title="No runs this week yet."
        body="Log one when you're out."
        action={<button>Log activity</button>}
      />,
    )
    expect(screen.getByText('No runs this week yet.')).toBeInTheDocument()
    expect(screen.getByText("Log one when you're out.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log activity' })).toBeInTheDocument()
  })

  test('PageHeader renders the h1, context and actions', () => {
    render(
      <PageHeader title="Plan" context="Week of 19 Oct, Base 2" actions={<button>Edit</button>} />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByText('Week of 19 Oct, Base 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})

describe('format helpers', () => {
  test('dates are en-GB and ignore the local time zone', () => {
    expect(formatShortDate('2026-10-19')).toBe('19 Oct')
    expect(formatWeekday('2026-10-19')).toBe('Mon')
    expect(formatLongDate('2026-10-19')).toBe('Mon 19 Oct 2026')
    expect(formatShortDate('2026-01-01')).toBe('1 Jan')
  })

  test('phase labels', () => {
    expect(phaseLabel('base2')).toBe('Base 2')
    expect(phaseLabel('race')).toBe('Race week')
    expect(phaseLabel('restart')).toBe('Restart')
    expect(phaseLabel('taper')).toBe('Taper')
  })
})

describe('expectCleanCopy', () => {
  test('passes clean copy, including "record" and RED-S', () => {
    const { container } = render(
      <section aria-label="Prediction track record">
        <h2>Record result</h2>
        <p>Relative energy deficiency (RED-S) signs are checked in every check-in.</p>
        <button type="button" title="Open the brief">
          Open
        </button>
      </section>,
    )
    expectCleanCopy(container)
  })

  test('fails on a banned word in any text node, and names where it is', () => {
    const { container } = render(
      <div>
        <p>
          Nothing here, and <b>you are behind</b> the plan.
        </p>
      </div>,
    )
    expect(() => {
      expectCleanCopy(container)
    }).toThrow(/text: "behind" in "you are behind"/)
  })

  test('also reads the accessible-name attributes', () => {
    for (const attributes of [
      { 'aria-label': 'Missed sessions' },
      { title: 'A new PR' },
      { placeholder: 'Keep the streak' },
    ]) {
      const { container, unmount } = render(<input type="text" {...attributes} />)
      expect(() => {
        expectCleanCopy(container)
      }).toThrow(/G5 lint/)
      unmount()
    }
    const { container } = render(<img src="x.png" alt="Great job!" />)
    expect(() => {
      expectCleanCopy(container)
    }).toThrow(/alt/)
  })

  test('skips script and style content', () => {
    const { container } = render(
      <div>
        <style>{'.red { color: red }'}</style>
        <p>Ready as planned.</p>
      </div>,
    )
    expectCleanCopy(container)
  })

  test('lints a portal when given document.body', () => {
    render(
      <Sheet open onClose={() => {}} title="Why this?">
        <p>Fail</p>
      </Sheet>,
    )
    expect(() => {
      expectCleanCopy(document.body)
    }).toThrow(/"Fail"/)
  })
})

describe('format helpers: climb', () => {
  test('climb is metres for km and feet for miles, and never NaN', () => {
    expect(formatClimb(60, 'km')).toBe('60 m')
    expect(formatClimb(60, 'mi')).toBe('197 ft')
    expect(formatClimb(Number.NaN, 'mi')).toBe('—')
  })
})
