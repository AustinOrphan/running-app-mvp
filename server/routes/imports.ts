import { Router } from 'express'
import type { Deps } from '../app.ts'

export function importsRouter(_deps: Deps): Router {
  return Router()
}
