// Stub from the training-engine scaffold; Task E14 implements it.
import { EmptyState } from '../components/EmptyState.tsx'
import { PageHeader } from '../components/PageHeader.tsx'

/** Topics, rules with grade badges, and papers with findings and DOI links. */
export function ResearchPage() {
  return (
    <>
      <PageHeader title="Research" context="The papers and rules behind the plan" />
      <EmptyState
        title="The research base is bundled with the app."
        body="Topics, rules and papers will appear here."
      />
    </>
  )
}
