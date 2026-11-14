// The Warning signs page (engine-rules section n, items 7 to 11): the signs a distance or ultra
// runner can notice that mean stop running and call emergency services, or stop running and see a
// clinician. The words are templates, spread into `TEMPLATES`, so the shared G5 lint renders them.
// Every sign names the corpus papers it rests on (`sources`), and a test checks that each exists.
// The list states what to do and does not diagnose; it carries no frequency and no risk.
import { tpl } from './template.ts'

/** The page's name: the heading, the nav row and the words every pain or illness sentence points to. */
export const WARNING_SIGNS_NAME = 'Warning signs'

/** The route of the page. */
export const WARNING_SIGNS_PATH = '/warning-signs'

export const WARNING_SIGNS_TEMPLATES = {
  'warning-signs.name': tpl(WARNING_SIGNS_NAME, {}, { shape: 'label' }),
  'warning-signs.note': tpl('Signs that mean stop running', {}, { shape: 'label' }),
  'warning-signs.intro': tpl(
    'These signs mean stop running. The list is for distance and ultra running, and it is not complete.',
  ),
  'warning-signs.sources-label': tpl('Papers it rests on', {}, { shape: 'label' }),
  'warning-signs.closing': tpl(
    'The list names signs and makes no diagnosis. If something feels wrong and is not here, stop anyway.',
  ),

  'warning-signs.emergency.heading': tpl(
    'Stop and call emergency services',
    {},
    { shape: 'label' },
  ),
  'warning-signs.emergency.lead': tpl(
    'Stop running, sit or lie down, and call the local emergency number. Ask someone nearby to stay.',
  ),
  'warning-signs.clinician.heading': tpl('Stop and see a clinician', {}, { shape: 'label' }),
  'warning-signs.clinician.lead': tpl(
    'Stop running and see a doctor or other qualified clinician before the next run.',
  ),

  'warning-signs.heart.title': tpl('Chest, breathing and heart', {}, { shape: 'label' }),
  'warning-signs.heart.detail': tpl(
    'Chest pain or pressure, breathlessness that is unusual for the effort, a racing or irregular heartbeat, dizziness, or fainting or nearly fainting.',
  ),
  'warning-signs.confusion.title': tpl('Confusion or collapse', {}, { shape: 'label' }),
  'warning-signs.confusion.detail': tpl(
    'Confusion, odd behaviour, a seizure or a collapse during or after a long or hot effort. Heat illness and low blood sodium can both look like this.',
  ),
  'warning-signs.sodium.title': tpl(
    'Headache, nausea or swelling after a long effort',
    {},
    { shape: 'label' },
  ),
  'warning-signs.sodium.detail': tpl(
    'A headache, nausea, or swollen hands or feet late in a long effort or after it, most of all after drinking a lot. Do not drink more.',
  ),
  'warning-signs.bone.title': tpl('Pain in one spot on a bone', {}, { shape: 'label' }),
  'warning-signs.bone.detail': tpl(
    'Pain in one small spot on a bone that hurts to press on, or that builds from run to run.',
  ),
  'warning-signs.pain.title': tpl('Pain that comes back', {}, { shape: 'label' }),
  'warning-signs.pain.detail': tpl(
    'Pain that starts again each time a run begins, or is still there the next day.',
  ),
  'warning-signs.fuel.title': tpl('Signs of under-fuelling', {}, { shape: 'label' }),
  'warning-signs.fuel.detail': tpl(
    'Periods that have stopped or become irregular, bone injuries that keep coming back, tiredness that does not lift, or weight loss that was not planned.',
  ),
  'warning-signs.muscle.title': tpl('Dark urine with severe muscle pain', {}, { shape: 'label' }),
  'warning-signs.muscle.detail': tpl(
    'Very dark urine, or very little, with severe muscle pain or weakness after a hard or long effort. Say if it was hot and if painkillers were taken.',
  ),
} as const

export type WarningSignsTemplateId = keyof typeof WARNING_SIGNS_TEMPLATES

export type WarningLevel = 'emergency' | 'clinician'

export interface WarningSign {
  id: string
  level: WarningLevel
  title: WarningSignsTemplateId
  detail: WarningSignsTemplateId
  /** Ids of the papers in `research/papers` that the sign rests on. */
  sources: readonly string[]
}

export const WARNING_LEVELS: ReadonlyArray<{
  id: WarningLevel
  heading: WarningSignsTemplateId
  lead: WarningSignsTemplateId
}> = [
  {
    id: 'emergency',
    heading: 'warning-signs.emergency.heading',
    lead: 'warning-signs.emergency.lead',
  },
  {
    id: 'clinician',
    heading: 'warning-signs.clinician.heading',
    lead: 'warning-signs.clinician.lead',
  },
]

/** The signs in the order shown: emergency first, then those for a clinician. */
export const WARNING_SIGNS: readonly WarningSign[] = [
  {
    id: 'heart',
    level: 'emergency',
    title: 'warning-signs.heart.title',
    detail: 'warning-signs.heart.detail',
    sources: ['marijon-2016-sca-warning-symptoms', 'stormholt-2021-sports-scd-symptoms'],
  },
  {
    id: 'confusion',
    level: 'emergency',
    title: 'warning-signs.confusion.title',
    detail: 'warning-signs.confusion.detail',
    sources: [
      'armstrong-2007-exertional-heat-illness',
      'hewbutler-2015-eah-consensus',
      'hewbutler-2017-eah-update',
    ],
  },
  {
    id: 'sodium',
    level: 'clinician',
    title: 'warning-signs.sodium.title',
    detail: 'warning-signs.sodium.detail',
    sources: ['hewbutler-2015-eah-consensus', 'hewbutler-2017-eah-update'],
  },
  {
    id: 'bone',
    level: 'clinician',
    title: 'warning-signs.bone.title',
    detail: 'warning-signs.bone.detail',
    sources: ['warden-2014-bsi-long-distance-runners', 'barrack-2014-bone-stress-triad'],
  },
  {
    id: 'pain',
    level: 'clinician',
    title: 'warning-signs.pain.title',
    detail: 'warning-signs.pain.detail',
    sources: ['bjsm-2019-bone-stress-return-to-run', 'warden-2014-bsi-long-distance-runners'],
  },
  {
    id: 'fuel',
    level: 'clinician',
    title: 'warning-signs.fuel.title',
    detail: 'warning-signs.fuel.detail',
    sources: ['mountjoy-2023-reds-consensus', 'melin-2014-leaf-q', 'hoeg-2022-ultramarathon-triad'],
  },
  {
    id: 'muscle',
    level: 'clinician',
    title: 'warning-signs.muscle.title',
    detail: 'warning-signs.muscle.detail',
    sources: ['clarkson-2007-rhabdomyolysis-marathon-renal'],
  },
]
