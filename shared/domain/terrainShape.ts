// The shape of the stored terrain bins (`Activity.terrainBins`): what the engine's grade curve
// (rule I13) and the import that writes the bins must agree on. Kept apart from the importer so
// `shared/engine` reads the shape without importing from `shared/importers`.

/** Version of the stored shape. A change of the edges, the window or the rules of the import raises it. */
export const TERRAIN_BINS_VERSION = 1
/**
 * Distance the grade is measured over, in metres. A distance window, not the time window of the
 * gap-distance grade, so a slow climb is no noisier than a fast one. Data preparation: about the
 * smallest span over which the rounded altitude steps and GNSS height noise (a few metres) stop
 * dominating a grade of a few percent. Stored with the bins.
 */
export const TERRAIN_WINDOW_M = 60
/**
 * Band edges in percent grade. A grade equal to an edge belongs to the band above it. The band
 * that holds 0 (-3 to 3) is the flat band the curve divides by. Data preparation: narrow bands
 * where running speed changes fastest (rolling terrain), wide open ends for the steep tails.
 */
export const TERRAIN_EDGES_PCT: readonly number[] = [-15, -10, -6, -3, 3, 6, 10, 15]
