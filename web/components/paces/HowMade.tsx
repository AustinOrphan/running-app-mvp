import { rulesRef } from '../../api/explain.ts'
import { pacesText } from '../../../shared/copy/myPaces.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import styles from './Paces.module.css'

export interface HowMadeProps {
  /** The sentences, each naming the rule its figure comes from. */
  lines: readonly string[]
  /** What the figures are, so the Why button is named for assistive technology. */
  subject: string
  /** The rule ids behind the section; the drawer shows their Params, grades and papers. */
  rules: readonly string[]
}

/** "How this is made" for one section: the rules in a sentence each, and the evidence behind them. */
export function HowMade({ lines, subject, rules }: HowMadeProps) {
  return (
    <details className={styles.how}>
      <summary className={styles.summary}>{pacesText('paces.how')}</summary>
      <ul className={styles.howList}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div>
        <ExplainButton subject={subject} rules={[...rules]} explain={rulesRef(rules)} />
      </div>
    </details>
  )
}
