import { useId } from 'react'
import { PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import type { CsTest } from '../../../shared/engine/myPaces.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

const T = PACES_TEMPLATES
const count = (n: number) => ({ kind: 'count' as const, n })

export interface TestSectionProps {
  test: CsTest
  units: Units
  /** Opens the instructions: the data is too thin for a prediction or an easy pace. */
  thin: boolean
}

/**
 * The guided test the engine supports (rules A6, L1): hard flat efforts at different distances give
 * a critical speed, which gives a pace range and a time at every distance. The instructions are
 * templates over the Params of the fit. Once critical speed is in place the section says so and
 * keeps the steps one tap away.
 */
export function TestSection({ test, units, thin }: TestSectionProps) {
  const headingId = useId()
  const [fitFrom, fitTo] = P.l1.csFitMinutes.value
  return (
    <section id="test" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.test.heading')}
      </h2>
      <p className={styles.text}>
        {test.done ? pacesText('paces.test.done') : pacesText('paces.test.intro')}
      </p>
      <p className={styles.note}>
        {render(
          T['paces.test.progress'],
          { have: count(test.efforts), need: count(test.need) },
          units,
        )}
      </p>
      <details className={styles.how} open={thin && !test.done}>
        <summary className={styles.summary}>{pacesText('paces.test.steps')}</summary>
        <ol className={styles.steps}>
          <li>
            {render(
              T['paces.test.step-efforts'],
              {
                need: count(test.need),
                min: { kind: 'distance', m: test.minM },
                max: { kind: 'distance', m: test.maxM },
              },
              units,
            )}
          </li>
          <li>
            {render(
              T['paces.test.step-spread'],
              {
                ratio: count(test.spreadRatio),
                from: { kind: 'minutes', min: fitFrom },
                to: { kind: 'minutes', min: fitTo },
              },
              units,
            )}
          </li>
          <li>{render(T['paces.test.step-log'], { days: count(test.windowDays) }, units)}</li>
        </ol>
        <p className={styles.note}>{pacesText('paces.test.care')}</p>
      </details>
      <HowMade
        lines={[pacesText('paces.test.how')]}
        subject="the critical speed test"
        rules={['A6', 'L1']}
      />
    </section>
  )
}
