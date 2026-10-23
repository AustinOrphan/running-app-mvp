// Writes the golden workout files next to this script. Run it after an intended change of the FIT
// format and commit the files; `workoutFit.test.ts` fails until they match the encoder.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWorkoutFit } from '../../../../server/services/workoutFit.ts'
import { GOLDEN_OPTIONS, GOLDEN_WORKOUTS } from './plans.ts'

const dir = import.meta.dirname
for (const [name, plan] of GOLDEN_WORKOUTS) {
  writeFileSync(join(dir, name), encodeWorkoutFit(plan, GOLDEN_OPTIONS))
}
