// The words of the health notice shown once before a first plan (FS1). Changing their meaning raises
// `PLAN_NOTICE_VERSION` (`shared/domain/planNotice.ts`). The PAR-Q+ is named and linked, never quoted:
// its licence allows the whole form without change, so the app asks none of its questions.
import { tpl } from './template.ts'

export const PLAN_NOTICE_TEMPLATES = {
  'plannotice.title': tpl('Before your first plan', {}, { shape: 'label' }),
  'plannotice.not-medical': tpl(
    'This app is a training log and planner. It is not medical advice.',
  ),
  'plannotice.parq': tpl(
    'Complete the official PAR-Q+ (version 01-11-2024, from the PAR-Q+ Collaboration) before you start.',
  ),
  'plannotice.follow': tpl(
    'Follow its guidance, including its follow-up pages, and see a doctor or a qualified exercise professional where it says to.',
  ),
  'plannotice.link': tpl('Open the official PAR-Q+ page', {}, { shape: 'label' }),
  'plannotice.keeps': tpl('The app does not ask the form questions and keeps no answers to them.'),
  'plannotice.age': tpl('The app is for runners aged 18 or older.'),
  'plannotice.age-check': tpl('I am 18 or older', {}, { shape: 'label' }),
  'plannotice.confirm': tpl('I have read this', {}, { shape: 'label' }),
  'plannotice.under': tpl(
    'The birth year on your profile makes you younger than 18, so the app does not make a plan for you.',
  ),
  'plannotice.required': tpl('Read the notice before your first plan.'),
  'plannotice.confirmed': tpl('Confirmed on {date}.', { date: 'text' }),
  'plannotice.profile-title': tpl('Health notice', {}, { shape: 'label' }),
} as const
