import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { createFatalHandler, installProcessErrorHandlers } from '../../../server/processErrors.ts'

describe('process-level error handlers', () => {
  test('the handler logs at fatal level with the error, then exits with code 1', () => {
    const calls: string[] = []
    const logger = { fatal: vi.fn(() => void calls.push('log')) }
    const exit = vi.fn(() => void calls.push('exit'))
    const error = new Error('boom')
    createFatalHandler(logger, exit)('uncaughtException', error)
    expect(logger.fatal).toHaveBeenCalledWith(
      { err: error, kind: 'uncaughtException' },
      expect.any(String),
    )
    expect(exit).toHaveBeenCalledWith(1)
    expect(calls).toEqual(['log', 'exit'])
  })

  test('install listens to both events once each and routes them to the handler', () => {
    const emitter = new EventEmitter()
    const exit = vi.fn()
    const logger = { fatal: vi.fn() }
    installProcessErrorHandlers(logger, Object.assign(emitter, { exit }) as never)
    expect(emitter.listenerCount('uncaughtException')).toBe(1)
    expect(emitter.listenerCount('unhandledRejection')).toBe(1)

    emitter.emit('unhandledRejection', 'rejected')
    expect(logger.fatal).toHaveBeenCalledWith(
      { err: 'rejected', kind: 'unhandledRejection' },
      expect.any(String),
    )
    expect(exit).toHaveBeenCalledWith(1)
    emitter.emit('uncaughtException', new Error('x'))
    expect(exit).toHaveBeenCalledTimes(2)
  })
})
