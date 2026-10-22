// Writes the research workflow result into research/ in the repository.
// Merges papers by DOI (or PMID), rewrites duplicate ids in rules and syntheses.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/austinorphan/src/running-app-mvp/.claude/worktrees/rewrite/research'
const result = JSON.parse(
  fs.readFileSync('/Users/austinorphan/.claude/jobs/938a2fff/tmp/research-result.json', 'utf8'),
)
const extra = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : []
const topics = [...result.topics.filter((t) => t.papers.length > 0), ...extra]

const canonicalByKey = new Map() // doi|pmid|id -> canonical id
const papers = new Map() // canonical id -> paper
const idMap = new Map() // any id -> canonical id

function keyOf(p) {
  if (p.doi) return `doi:${p.doi.toLowerCase().trim()}`
  if (p.pmid) return `pmid:${p.pmid}`
  return `id:${p.id}`
}

for (const t of topics) {
  for (const p of t.papers) {
    const k = keyOf(p)
    let canon = canonicalByKey.get(k)
    if (!canon) {
      canon = p.id
      // the same id used for a different paper: suffix it
      let n = 2
      while (papers.has(canon) && keyOf(papers.get(canon)) !== k) canon = `${p.id}-${n++}`
      canonicalByKey.set(k, canon)
      papers.set(canon, {
        ...p,
        id: canon,
        doi: p.doi ? p.doi.toLowerCase().trim() : null,
        topics: [t.key],
      })
    } else {
      const existing = papers.get(canon)
      if (!existing.topics.includes(t.key)) existing.topics.push(t.key)
      // keep the richer record's findings/implications as a union
      for (const f of ['findings', 'implications']) {
        for (const line of p[f]) if (!existing[f].includes(line)) existing[f].push(line)
      }
    }
    idMap.set(`${t.key}::${p.id}`, canon)
    if (!idMap.has(p.id)) idMap.set(p.id, canon)
  }
}

const resolve = (topicKey, id) => idMap.get(`${topicKey}::${id}`) ?? idMap.get(id) ?? null

fs.rmSync(ROOT, { recursive: true, force: true })
for (const d of ['papers', 'topics', 'rules']) fs.mkdirSync(path.join(ROOT, d), { recursive: true })

for (const [id, p] of [...papers].sort(([a], [b]) => a.localeCompare(b))) {
  const out = {
    id,
    title: p.title,
    authors: p.authors,
    year: p.year,
    journal: p.journal,
    doi: p.doi,
    pmid: p.pmid,
    url: p.url,
    design: p.design,
    population: p.population,
    sampleSize: p.sampleSize,
    evidenceLevel: p.evidenceLevel,
    topics: p.topics.sort(),
    findings: p.findings,
    limitations: p.limitations,
    implications: p.implications,
    verification: { ...p.verification, checkedAt: '2026-10-22' },
  }
  fs.writeFileSync(path.join(ROOT, 'papers', `${id}.json`), JSON.stringify(out, null, 2) + '\n')
}

const unresolved = []
for (const t of topics) {
  const rules = t.rules.map((r) => ({
    ...r,
    evidence: r.evidence.map((e) => {
      const c = resolve(t.key, e)
      if (!c) unresolved.push(`${t.key} rule ${r.id} -> ${e}`)
      return c ?? e
    }),
  }))
  fs.writeFileSync(path.join(ROOT, 'rules', `${t.key}.json`), JSON.stringify(rules, null, 2) + '\n')
  const synthesis = t.synthesis.replace(/\[([a-z0-9][a-z0-9-]*)\]/g, (m, id) => {
    const c = resolve(t.key, id)
    return c ? `[${c}]` : m
  })
  const ruleRows = rules
    .map(
      (r) =>
        `| ${r.id} | ${r.statement.replace(/\|/g, '\\|')} | ${[r.value, r.unit].filter(Boolean).join(' ') || '-'} | ${r.grade} | ${r.confidence} | ${r.evidence.join(', ')} |`,
    )
    .join('\n')
  const paperList = [...new Set(t.papers.map((p) => resolve(t.key, p.id)))]
    .map((id) => {
      const p = papers.get(id)
      return `- [${id}] ${p.authors.split(',')[0]} et al. (${p.year}). ${p.title}. *${p.journal}*. ${p.doi ? `https://doi.org/${p.doi}` : p.url} — ${p.design}, level ${p.evidenceLevel}`
    })
    .join('\n')
  const md = `# ${t.title}\n\n${synthesis.trim()}\n\n## Rules\n\n| Id | Rule | Value | Grade | Confidence | Evidence |\n| --- | --- | --- | --- | --- | --- |\n${ruleRows}\n\n## Gaps\n\n${t.gaps.map((g) => `- ${g}`).join('\n')}\n\n## Papers\n\n${paperList}\n`
  fs.writeFileSync(path.join(ROOT, 'topics', `${t.key}.md`), md)
}

let engine = result.engineRules.replace(/\[([a-z0-9][a-z0-9-]*)\]/g, (m, id) => {
  const c = idMap.get(id)
  return c ? `[${c}]` : m
})
fs.writeFileSync(path.join(ROOT, 'engine-rules.md'), engine.trim() + '\n')

const unknownInEngine = [
  ...new Set(
    [...result.engineRules.matchAll(/\[([a-z0-9][a-z0-9-]*-(?:19|20)\d\d[a-z0-9-]*)\]/g)].map(
      (m) => m[1],
    ),
  ),
].filter((id) => !idMap.has(id))
console.log(
  `papers ${papers.size}; topics ${topics.length}; unresolved rule refs ${unresolved.length}; unknown ids in engine-rules ${unknownInEngine.length}`,
)
if (unresolved.length) console.log('unresolved:', unresolved.slice(0, 20).join('\n  '))
if (unknownInEngine.length)
  console.log('unknown in engine-rules:', unknownInEngine.slice(0, 30).join(', '))
