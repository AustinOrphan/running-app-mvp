// Writes a corpus workflow result into research/ (papers, topics, rules).
//
//   node research/tools/write-corpus.mjs <result.json> [extra.json] [--engine-rules]
//
// <result.json>   the JSON returned by build-corpus.workflow.js (topics, missing, engineRules).
// [extra.json]    optional: an array of extra topics in the same shape as result.topics, for a
//                 second pass on one topic (for example terrain-elevation).
// --engine-rules  also overwrite research/engine-rules.md with result.engineRules. Off by
//                 default because that file is edited by hand after integration (terrain
//                 additions, resolved conflicts) and the workflow output would discard those.
//
// The script merges into research/: papers already stored keep their ids and files, and a new
// record with the same DOI (or PMID, or id) joins the stored paper. A repeated id for another
// paper gets a numeric suffix, and every citation in the rules and syntheses of the topics in
// the input is rewritten to the final id. It writes research/topics/<key>.md and
// research/rules/<key>.json only for the topics in the input and never deletes a file.
// Paths are relative to this file; nothing outside the repository is read except the inputs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const writeEngineRules = args.includes('--engine-rules')
const [resultPath, extraPath] = args.filter((arg) => !arg.startsWith('--'))
if (!resultPath) {
  console.error(
    'usage: node research/tools/write-corpus.mjs <result.json> [extra.json] [--engine-rules]',
  )
  process.exit(2)
}
const result = JSON.parse(fs.readFileSync(path.resolve(resultPath), 'utf8'))
const extra = extraPath ? JSON.parse(fs.readFileSync(path.resolve(extraPath), 'utf8')) : []
const topics = [...result.topics.filter((t) => t.papers.length > 0), ...extra]

const canonicalByKey = new Map() // doi|pmid|id -> canonical id
const papers = new Map() // canonical id -> paper
const idMap = new Map() // any id -> canonical id

function keyOf(p) {
  if (p.doi) return `doi:${p.doi.toLowerCase().trim()}`
  if (p.pmid) return `pmid:${p.pmid}`
  return `id:${p.id}`
}

// Papers already in research/papers keep their ids; a new record with the same DOI merges into one.
const today = new Date().toISOString().slice(0, 10)
fs.mkdirSync(path.join(ROOT, 'papers'), { recursive: true })
for (const file of fs.readdirSync(path.join(ROOT, 'papers')).filter((f) => f.endsWith('.json'))) {
  const stored = JSON.parse(fs.readFileSync(path.join(ROOT, 'papers', file), 'utf8'))
  papers.set(stored.id, stored)
  canonicalByKey.set(keyOf(stored), stored.id)
  idMap.set(stored.id, stored.id)
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

for (const d of ['topics', 'rules']) fs.mkdirSync(path.join(ROOT, d), { recursive: true })

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
    verification: { ...p.verification, checkedAt: p.verification.checkedAt ?? today },
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

if (writeEngineRules) {
  const engine = result.engineRules.replace(/\[([a-z0-9][a-z0-9-]*)\]/g, (m, id) => {
    const c = idMap.get(id)
    return c ? `[${c}]` : m
  })
  fs.writeFileSync(path.join(ROOT, 'engine-rules.md'), engine.trim() + '\n')
}

const unknownInEngine = writeEngineRules
  ? [
      ...new Set(
        [...result.engineRules.matchAll(/\[([a-z0-9][a-z0-9-]*-(?:19|20)\d\d[a-z0-9-]*)\]/g)].map(
          (m) => m[1],
        ),
      ),
    ].filter((id) => !idMap.has(id))
  : []
console.log(
  `papers ${papers.size}; topics ${topics.length}; unresolved rule refs ${unresolved.length}; unknown ids in engine-rules ${unknownInEngine.length}`,
)
if (unresolved.length) console.log('unresolved:', unresolved.slice(0, 20).join('\n  '))
if (unknownInEngine.length)
  console.log('unknown in engine-rules:', unknownInEngine.slice(0, 30).join(', '))
