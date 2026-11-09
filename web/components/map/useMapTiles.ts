import { createDeviceSwitch } from '../deviceSwitch.ts'

/**
 * The Map tiles switch: a device setting like the theme and the Condensed figures switch, kept in
 * `localStorage` and on until the runner turns it off. Off, the run map draws the route alone and
 * no request leaves for the tile server.
 */
export const MAP_TILES_KEY = 'rl_map_tiles'

export const useMapTiles = createDeviceSwitch(MAP_TILES_KEY, true)
