import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { HttpError, conflict, errorHandler } from '../../../server/errors.ts'

function appThrowing(error: unknown) {
  const app = express()
  app.get('/boom', () => {
    throw error
  })
  app.use(errorHandler(pino({ level: 'silent' })))
  return app
}

describe('conflict', () => {
  test('keeps a message-only call working: 409, code conflict, no details', async () => {
    const error = conflict('Setup is closed.')
    expect(error).toBeInstanceOf(HttpError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('conflict')
    expect(error.details).toBeUndefined()

    const response = await request(appThrowing(error)).get('/boom')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ error: { code: 'conflict', message: 'Setup is closed.' } })
  })

  test('carries details to the response body', async () => {
    const details = { requires: 'replacePlan', planGoalId: 'g1', planGoalName: 'Autumn race' }
    const error = conflict('The plan follows another goal.', details)
    expect(error.details).toEqual(details)

    const response = await request(appThrowing(error)).get('/boom')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: { code: 'conflict', message: 'The plan follows another goal.', details },
    })
  })

  test('passes list-shaped details such as guards and a stale-preview code through', async () => {
    const details = { code: 'stale-preview', reasons: ['a', 'b'], guards: [{ id: 'x' }] }
    const response = await request(appThrowing(conflict('Preview is out of date.', details))).get(
      '/boom',
    )
    expect(response.body).toEqual({
      error: { code: 'conflict', message: 'Preview is out of date.', details },
    })
  })
})
