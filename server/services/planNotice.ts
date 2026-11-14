import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { todayIso } from '../../shared/dates.ts'
import { ageStanding, PLAN_NOTICE_VERSION } from '../../shared/domain/planNotice.ts'
import type { PlanNoticeView } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { HttpError, conflict, notFound } from '../errors.ts'

/** The `details.code` of the conflict that plan generation answers with while the gate is shut. */
export const PLAN_NOTICE_REQUIRED = 'plan-notice-required'
export const PLAN_UNDER_AGE = 'under-age'

const UNDER_AGE_MESSAGE = render(TEMPLATES['plannotice.under'], {}, 'km')

/**
 * The health notice and the minimum age (FS1). The gate shuts the first plan only: a runner who
 * already has a plan row (active or archived) is never blocked, so accounts from before the notice
 * keep working and see it once, from the Profile. Restoring an archived plan needs an existing
 * plan, so the one gate is `POST /api/plan/generate`.
 */
export async function loadPlanNotice(
  prisma: PrismaClient,
  userId: string,
): Promise<PlanNoticeView> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      planNoticeVersion: true,
      planNoticeAt: true,
      profile: { select: { birthYear: true } },
    },
  })
  if (!user) throw notFound()
  const age = ageStanding(user.profile?.birthYear ?? null, Number(todayIso().slice(0, 4)))
  const confirmed = user.planNoticeVersion === PLAN_NOTICE_VERSION
  const hasPlan = (await prisma.plan.count({ where: { userId } })) > 0
  return {
    version: PLAN_NOTICE_VERSION,
    confirmedVersion: user.planNoticeVersion,
    confirmedAt: user.planNoticeAt?.toISOString() ?? null,
    required: !hasPlan && (!confirmed || age === 'under'),
    age,
  }
}

/** Throws the error that plan generation answers with while the notice is unconfirmed or under age. */
export async function requirePlanNotice(prisma: PrismaClient, userId: string): Promise<void> {
  const view = await loadPlanNotice(prisma, userId)
  if (!view.required) return
  if (view.age === 'under') {
    throw new HttpError(409, 'conflict', UNDER_AGE_MESSAGE, { code: PLAN_UNDER_AGE })
  }
  throw conflict('Read the health notice before the first plan.', { code: PLAN_NOTICE_REQUIRED })
}

/** Stores the confirmation with its time and the version of the words that were shown. */
export async function confirmPlanNotice(
  prisma: PrismaClient,
  userId: string,
  input: { version: number; ageConfirmed: boolean },
  now: Date,
): Promise<PlanNoticeView> {
  const view = await loadPlanNotice(prisma, userId)
  if (input.version !== PLAN_NOTICE_VERSION) {
    throw conflict('The notice changed. Read it again.', { code: 'stale-notice' })
  }
  if (view.age === 'under') {
    throw new HttpError(409, 'conflict', UNDER_AGE_MESSAGE, { code: PLAN_UNDER_AGE })
  }
  if (view.age === 'ask' && !input.ageConfirmed) {
    throw conflict('Confirm that you are 18 or older.', { code: 'age-statement-required' })
  }
  await prisma.user.update({
    where: { id: userId },
    data: { planNoticeVersion: PLAN_NOTICE_VERSION, planNoticeAt: now },
  })
  return loadPlanNotice(prisma, userId)
}
