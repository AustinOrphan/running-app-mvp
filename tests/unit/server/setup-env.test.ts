import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ensureEnvFile } from '../../../scripts/setup-env.ts'

let dir: string
let envPath: string
let examplePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'setup-env-'))
  envPath = join(dir, '.env')
  examplePath = join(dir, '.env.example')
  writeFileSync(examplePath, 'PORT=3001\nSESSION_SECRET=\nLOG_LEVEL=info\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function secretOf(text: string): string {
  return /^SESSION_SECRET=(.*)$/m.exec(text)?.[1] ?? ''
}

describe('ensureEnvFile', () => {
  test('creates .env from the example with a generated secret', () => {
    const result = ensureEnvFile(envPath, examplePath)
    expect(result).toEqual({ created: true, generatedSecret: true })
    const text = readFileSync(envPath, 'utf8')
    expect(secretOf(text).length).toBeGreaterThanOrEqual(32)
    expect(text).toContain('PORT=3001')
  })

  test('fills an empty secret and keeps the other lines', () => {
    writeFileSync(envPath, 'PORT=4000\nSESSION_SECRET=\nLOG_LEVEL=debug\n')
    const result = ensureEnvFile(envPath, examplePath)
    expect(result).toEqual({ created: false, generatedSecret: true })
    const text = readFileSync(envPath, 'utf8')
    expect(secretOf(text).length).toBeGreaterThanOrEqual(32)
    expect(text).toContain('PORT=4000\n')
    expect(text).toContain('LOG_LEVEL=debug\n')
  })

  test('adds a secret when the line is absent', () => {
    writeFileSync(envPath, 'PORT=4000')
    ensureEnvFile(envPath, examplePath)
    const text = readFileSync(envPath, 'utf8')
    expect(text.startsWith('PORT=4000\n')).toBe(true)
    expect(secretOf(text).length).toBeGreaterThanOrEqual(32)
  })

  test('never overwrites an existing secret', () => {
    writeFileSync(envPath, 'SESSION_SECRET=keep-this-secret-keep-this-secret-1234\n')
    const result = ensureEnvFile(envPath, examplePath)
    expect(result).toEqual({ created: false, generatedSecret: false })
    expect(secretOf(readFileSync(envPath, 'utf8'))).toBe('keep-this-secret-keep-this-secret-1234')
  })

  test('two runs generate once', () => {
    expect(ensureEnvFile(envPath, examplePath).generatedSecret).toBe(true)
    const first = secretOf(readFileSync(envPath, 'utf8'))
    expect(ensureEnvFile(envPath, examplePath)).toEqual({ created: false, generatedSecret: false })
    expect(secretOf(readFileSync(envPath, 'utf8'))).toBe(first)
  })
})
