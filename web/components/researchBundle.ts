// The research corpus as one chunk. Only `researchCorpus.ts` imports this file, and only through a
// dynamic `import()`, so the corpus stays out of the entry chunk and loads when the Research page
// or the why drawer first needs it.
import type { CorpusPaper, CorpusRule } from './researchCorpus.ts'

const paperModules = import.meta.glob<CorpusPaper>('../../research/papers/*.json', {
  eager: true,
  import: 'default',
})
const ruleModules = import.meta.glob<CorpusRule[]>('../../research/rules/*.json', {
  eager: true,
  import: 'default',
})
const topicModules = import.meta.glob<string>('../../research/topics/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

function keyOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
}

export const papers: CorpusPaper[] = Object.values(paperModules)
export const rulesByTopic: Record<string, CorpusRule[]> = Object.fromEntries(
  Object.entries(ruleModules).map(([path, rules]) => [keyOf(path), rules]),
)
export const topicTexts: Record<string, string> = Object.fromEntries(
  Object.entries(topicModules).map(([path, text]) => [keyOf(path), text]),
)
