import { Link } from 'react-router-dom'
import { WARNING_SIGNS_NAME, WARNING_SIGNS_PATH } from '../../shared/copy/warningSigns.ts'

/**
 * A rendered sentence in which the name of the Warning signs page, where the sentence has it, is a
 * link to the page. Pain and illness sentences (the brief, "What stood out", a run's assessment) are
 * rendered strings, so this is the one place that turns their pointer into a way there.
 */
export function WarningSignsText({
  text,
  onNavigate,
}: {
  text: string
  /** Called when the link is followed, where the sentence sits in a drawer that must close. */
  onNavigate?: () => void
}) {
  const at = text.indexOf(WARNING_SIGNS_NAME)
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <Link to={WARNING_SIGNS_PATH} onClick={onNavigate}>
        {WARNING_SIGNS_NAME}
      </Link>
      {text.slice(at + WARNING_SIGNS_NAME.length)}
    </>
  )
}
