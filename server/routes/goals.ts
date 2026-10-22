import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { conflict, notFound, parse } from '../errors.ts'
import { toGoal } from '../serialize.ts'

/** Trimmed text; an empty string becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value ? value : null))
  .refine((value) => {
    if (value === null) return true
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Use an http or https link.')

const goalBody = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(['A', 'B', 'C']),
  status: z.enum(['target', 'considering', 'done', 'dropped']).default('target'),
  targetDate: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD.'),
  dateProvisional: z.boolean().default(false),
  distanceM: z.number().int().min(1).max(500_000).nullish(),
  location: optionalText(200),
  successCriteria: optionalText(2000),
  notes: optionalText(5000),
  url: optionalUrl,
})

/** PUT changes only the fields it carries; a null or empty text field clears the value. */
const goalPatch = z.object({
  name: goalBody.shape.name.optional(),
  priority: goalBody.shape.priority.optional(),
  status: z.enum(['target', 'considering', 'done', 'dropped']).optional(),
  targetDate: goalBody.shape.targetDate.optional(),
  dateProvisional: z.boolean().optional(),
  distanceM: goalBody.shape.distanceM,
  location: z.string().trim().max(200).nullish(),
  successCriteria: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  url: z.string().trim().max(500).nullish(),
})

function checkUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  return parse(optionalUrl, value)
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null
}

export function goalsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  async function ownedGoal(userId: string, id: string) {
    const goal = await prisma.goal.findFirst({ where: { id, userId } })
    if (!goal) throw notFound('Goal not found.')
    return goal
  }

  router.get('/', async (req, res) => {
    const goals = await prisma.goal.findMany({
      where: { userId: req.userId },
      orderBy: [{ targetDate: 'asc' }, { createdAt: 'asc' }],
    })
    res.json(goals.map(toGoal))
  })

  router.post('/', async (req, res) => {
    const body = parse(goalBody, req.body)
    const goal = await prisma.goal.create({
      data: {
        userId: req.userId,
        name: body.name,
        priority: body.priority,
        status: body.status,
        targetDate: body.targetDate,
        dateProvisional: body.dateProvisional,
        distanceM: body.distanceM ?? null,
        location: body.location,
        successCriteria: body.successCriteria,
        notes: body.notes,
        url: body.url,
      },
    })
    res.status(201).json(toGoal(goal))
  })

  router.get('/:id', async (req, res) => {
    res.json(toGoal(await ownedGoal(req.userId, req.params.id)))
  })

  router.put('/:id', async (req, res) => {
    const body = parse(goalPatch, req.body)
    const url = checkUrl(body.url)
    await ownedGoal(req.userId, req.params.id)
    const goal = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        priority: body.priority,
        status: body.status,
        targetDate: body.targetDate,
        dateProvisional: body.dateProvisional,
        // A finished or dropped goal cannot stay active, matching the activate rule.
        ...(body.status === 'done' || body.status === 'dropped' ? { isActive: false } : {}),
        distanceM: body.distanceM,
        location: blankToNull(body.location),
        successCriteria: blankToNull(body.successCriteria),
        notes: blankToNull(body.notes),
        url,
      },
    })
    res.json(toGoal(goal))
  })

  router.delete('/:id', async (req, res) => {
    await ownedGoal(req.userId, req.params.id)
    const activePlans = await prisma.plan.count({
      where: { goalId: req.params.id, status: 'active' },
    })
    if (activePlans > 0) {
      throw conflict('This goal has an active plan. Generate a plan for another goal first.')
    }
    await prisma.goal.delete({ where: { id: req.params.id } })
    res.status(204).end()
  })

  router.post('/:id/activate', async (req, res) => {
    const goal = await ownedGoal(req.userId, req.params.id)
    if (goal.status === 'done' || goal.status === 'dropped') {
      throw conflict('A finished or dropped goal cannot be the active goal.')
    }
    const activated = await prisma.$transaction(async (tx) => {
      await tx.goal.updateMany({ where: { userId: req.userId }, data: { isActive: false } })
      return tx.goal.update({ where: { id: goal.id }, data: { isActive: true } })
    })
    res.json(toGoal(activated))
  })

  return router
}
