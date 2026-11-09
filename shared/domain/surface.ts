// Trail, paved path and road (M1d): which of the three an OpenStreetMap way is, from its tags. A pure
// function over the five tags that decide it. Nothing in `shared/engine` reads the result; it is a
// description of where a run went, not a training input.

/** Version of the bins' shape and of the matcher; a change raises it and every run is computed again. */
export const SURFACE_VERSION = 1
/**
 * Version of the tag-to-class rules below. The class of a way is stored when the area is
 * downloaded, so a change here is picked up by downloading again; Settings says so when the stored
 * area was classified under an older version.
 */
export const SURFACE_CLASS_VERSION = 1

/** The tags the download keeps (the ones the class rules read, and `foot` and `access` to leave out what a runner cannot use). */
export const SURFACE_TAGS = [
  'highway',
  'surface',
  'tracktype',
  'footway',
  'sac_scale',
  'foot',
  'access',
] as const
export type SurfaceTags = Readonly<Partial<Record<(typeof SURFACE_TAGS)[number], string>>>

/** A stored way's class. `unknown` is a way a runner can use whose kind the tags do not settle. */
export type WayClass = 'trail' | 'paved' | 'road' | 'unknown'

/** The one-letter code a way's class is stored under. */
export const WAY_CODES: Readonly<Record<WayClass, string>> = {
  trail: 't',
  paved: 'p',
  road: 'r',
  unknown: 'u',
}

export function wayClassOfCode(code: string): WayClass | null {
  for (const cls of Object.keys(WAY_CODES) as WayClass[]) if (WAY_CODES[cls] === code) return cls
  return null
}

/** Highways that are paths for people on foot, bike or horse. */
const PATH_HIGHWAYS: ReadonlySet<string> = new Set(['path', 'track', 'bridleway'])
/** Highways built for walking and cycling; their kind comes from the surface. */
const FOOT_HIGHWAYS: ReadonlySet<string> = new Set(['footway', 'cycleway', 'pedestrian', 'steps'])
/** Highways open to cars that a runner can be on. */
const ROAD_HIGHWAYS: ReadonlySet<string> = new Set([
  'residential',
  'service',
  'unclassified',
  'living_street',
  'road',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
])
/** Highways that are not a way a runner uses (no foot access, not built, or not a way at all). */
const NOT_RUNNABLE: ReadonlySet<string> = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'construction',
  'proposed',
  'raceway',
  'bus_guideway',
  'busway',
  'platform',
  'elevator',
  'corridor',
  'services',
  'rest_area',
  'abandoned',
  'razed',
  'via_ferrata',
  'no',
])

/** Surfaces that are soft or loose: a trail underfoot whatever the highway is called. */
const UNPAVED: ReadonlySet<string> = new Set([
  'unpaved',
  'compacted',
  'fine_gravel',
  'gravel',
  'pebblestone',
  'dirt',
  'earth',
  'ground',
  'mud',
  'grass',
  'sand',
  'rock',
  'clay',
  'woodchips',
  'wood_chips',
  'salt',
  'snow',
  'ice',
  'grass_paver',
  'dirt/sand',
])
/** Surfaces that are laid hard. */
const PAVED: ReadonlySet<string> = new Set([
  'paved',
  'asphalt',
  'concrete',
  'concrete:plates',
  'concrete:lanes',
  'paving_stones',
  'sett',
  'cobblestone',
  'unhewn_cobblestone',
  'bricks',
  'brick',
  'metal',
  'tartan',
  'rubber',
  'bitumen',
  'chipseal',
])
const ROUGH_TRACKTYPES: ReadonlySet<string> = new Set(['grade2', 'grade3', 'grade4', 'grade5'])

/**
 * The class of a way from its tags, or null for a way that is not stored (not a highway, or one a
 * runner cannot use). In order:
 *
 * 1. no `highway`, a highway that is not for runners (motorway, trunk, under construction), or
 *    `foot=no` / a closed `access` without a foot exception: null.
 * 2. trail: an unpaved `surface`, any `sac_scale` but `none`, or `tracktype` grade2 to grade5, on any
 *    highway; otherwise a `path`, `track` or `bridleway` with no paved surface.
 * 3. paved path: a `track` of `tracktype=grade1` with no surface, a `footway`, `cycleway`, `pedestrian`, `steps` or `bridleway` with a paved surface,
 *    or a sidewalk or crossing (`footway=sidewalk|crossing`); a `path` with a paved surface.
 * 4. road: a car highway (residential, service, unclassified, living_street, tertiary and up), and
 *    a `track` with a paved surface (a farm lane).
 * 5. unknown: a footway-type way whose surface the tags do not give, and any highway value not named
 *    above. Unknown tags lean to road only for car highways.
 */
export function classifyWay(tags: SurfaceTags): WayClass | null {
  const highway = tags.highway
  if (highway === undefined || NOT_RUNNABLE.has(highway)) return null
  if (tags.foot === 'no') return null
  const footOk = tags.foot === 'yes' || tags.foot === 'designated' || tags.foot === 'permissive'
  if ((tags.access === 'no' || tags.access === 'private') && !footOk) return null

  const surface = tags.surface
  const paved = surface !== undefined && PAVED.has(surface)
  if (surface !== undefined && UNPAVED.has(surface)) return 'trail'
  if (tags.sac_scale !== undefined && tags.sac_scale !== 'none') return 'trail'
  if (tags.tracktype !== undefined && ROUGH_TRACKTYPES.has(tags.tracktype)) return 'trail'

  // `tracktype=grade1` is a solid, usually paved track: a paved path unless a surface says otherwise.
  if (highway === 'track' && tags.tracktype === 'grade1' && surface === undefined) return 'paved'

  if (ROAD_HIGHWAYS.has(highway)) return 'road'
  if (PATH_HIGHWAYS.has(highway)) {
    if (!paved) return 'trail'
    if (highway === 'track') return 'road'
    return 'paved'
  }
  if (FOOT_HIGHWAYS.has(highway)) {
    if (paved || tags.footway === 'sidewalk' || tags.footway === 'crossing') return 'paved'
    return 'unknown'
  }
  return 'unknown'
}
