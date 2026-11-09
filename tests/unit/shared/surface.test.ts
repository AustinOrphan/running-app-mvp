import { describe, expect, test } from 'vitest'
import {
  classifyWay,
  WAY_CODES,
  wayClassOfCode,
  type SurfaceTags,
} from '../../../shared/domain/surface.ts'

describe('classifyWay', () => {
  const cases: Array<[string, SurfaceTags, ReturnType<typeof classifyWay>]> = [
    // trail
    ['a path with no surface', { highway: 'path' }, 'trail'],
    ['a track with no surface', { highway: 'track' }, 'trail'],
    ['a bridleway', { highway: 'bridleway' }, 'trail'],
    ['a footway of dirt', { highway: 'footway', surface: 'dirt' }, 'trail'],
    ['a path of gravel', { highway: 'path', surface: 'gravel' }, 'trail'],
    ['a service road of gravel', { highway: 'service', surface: 'gravel' }, 'trail'],
    ['a residential street of grass', { highway: 'residential', surface: 'grass' }, 'trail'],
    ['a cycleway of compacted fines', { highway: 'cycleway', surface: 'compacted' }, 'trail'],
    ['a tertiary road of sand', { highway: 'tertiary', surface: 'sand' }, 'trail'],
    ['a footway of rock', { highway: 'footway', surface: 'rock' }, 'trail'],
    ['a track of grade 2', { highway: 'track', tracktype: 'grade2' }, 'trail'],
    ['a residential street of grade 4', { highway: 'residential', tracktype: 'grade4' }, 'trail'],
    ['a footway with any sac_scale', { highway: 'footway', sac_scale: 'hiking' }, 'trail'],
    [
      'a paved path with a sac_scale',
      { highway: 'path', surface: 'asphalt', sac_scale: 'mountain_hiking' },
      'trail',
    ],
    // paved path
    ['a footway of asphalt', { highway: 'footway', surface: 'asphalt' }, 'paved'],
    ['a cycleway of concrete', { highway: 'cycleway', surface: 'concrete' }, 'paved'],
    [
      'a pedestrian street of paving stones',
      { highway: 'pedestrian', surface: 'paving_stones' },
      'paved',
    ],
    ['a path of asphalt', { highway: 'path', surface: 'asphalt' }, 'paved'],
    ['a sidewalk without a surface', { highway: 'footway', footway: 'sidewalk' }, 'paved'],
    ['a crossing without a surface', { highway: 'footway', footway: 'crossing' }, 'paved'],
    ['a bridleway of asphalt', { highway: 'bridleway', surface: 'asphalt' }, 'paved'],
    // road
    ['a residential street', { highway: 'residential' }, 'road'],
    ['a residential street of asphalt', { highway: 'residential', surface: 'asphalt' }, 'road'],
    ['a service road', { highway: 'service' }, 'road'],
    ['a tertiary road', { highway: 'tertiary' }, 'road'],
    ['a primary road', { highway: 'primary' }, 'road'],
    ['a secondary link', { highway: 'secondary_link' }, 'road'],
    ['a living street', { highway: 'living_street' }, 'road'],
    ['an unclassified road', { highway: 'unclassified' }, 'road'],
    ['a track of asphalt (a farm lane)', { highway: 'track', surface: 'asphalt' }, 'road'],
    [
      'a road of a surface value nobody listed',
      { highway: 'residential', surface: 'something_new' },
      'road',
    ],
    [
      'tracktype grade1 on a residential street',
      { highway: 'residential', tracktype: 'grade1' },
      'road',
    ],
    ['a grade 1 track with no surface', { highway: 'track', tracktype: 'grade1' }, 'paved'],
    [
      'a grade 1 track of dirt',
      { highway: 'track', tracktype: 'grade1', surface: 'dirt' },
      'trail',
    ],
    // unknown: lean to road only for car highways
    ['a footway with no surface', { highway: 'footway' }, 'unknown'],
    ['a cycleway with no surface', { highway: 'cycleway' }, 'unknown'],
    ['steps', { highway: 'steps' }, 'unknown'],
    ['a highway value nobody listed', { highway: 'something_new' }, 'unknown'],
    [
      'a footway of a surface value nobody listed',
      { highway: 'footway', surface: 'something_new' },
      'unknown',
    ],
    // not stored
    ['a motorway', { highway: 'motorway' }, null],
    ['a trunk road', { highway: 'trunk' }, null],
    ['a road under construction', { highway: 'construction' }, null],
    ['a way with no highway tag', {}, null],
    ['foot=no', { highway: 'residential', foot: 'no' }, null],
    ['a private road', { highway: 'service', access: 'private' }, null],
    ['a private road open to foot', { highway: 'service', access: 'private', foot: 'yes' }, 'road'],
  ]
  test.each(cases)('%s', (_name, tags, expected) => {
    expect(classifyWay(tags)).toBe(expected)
  })

  test('the stored codes round-trip and are distinct', () => {
    const codes = Object.values(WAY_CODES)
    expect(new Set(codes).size).toBe(codes.length)
    for (const [cls, code] of Object.entries(WAY_CODES)) expect(wayClassOfCode(code)).toBe(cls)
    expect(wayClassOfCode('x')).toBeNull()
  })
})
