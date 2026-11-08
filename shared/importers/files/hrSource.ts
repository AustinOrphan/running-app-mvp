// Where a FIT file's heart rate came from, read from its `device_info` messages (rule B2, batch HQ1).
// An external heart-rate sensor (a chest strap or an armband) is listed as its own device: an ANT+
// device of type 120 (`antplus_device_type` `heart_rate`) or a Bluetooth LE device of type 1
// (`ble_device_type` `heart_rate`), with a `source_type` of `antplus`/`ant` or
// `bluetooth_low_energy`/`bluetooth`. The decoder keeps `device_type` as the raw number, so both the
// number and the name are accepted. A device on the watch itself has `source_type` `local` and is
// not an external sensor. Pure, so the import and the backfill agree.
import type { HrSource } from '../../types.ts'

type Message = Record<string, unknown>

const ANT_SOURCES = new Set(['ant', 'antplus'])
const BLE_SOURCES = new Set(['bluetooth', 'bluetooth_low_energy'])
/** `antplus_device_type.heart_rate` and `ble_device_type.heart_rate` of the FIT profile. */
const ANT_HEART_RATE = 120
const BLE_HEART_RATE = 1

function isHeartRateType(value: unknown, code: number): boolean {
  return value === code || value === 'heart_rate'
}

/** Whether one `device_info` message is an external heart-rate sensor. */
export function isHeartRateSensor(info: Message): boolean {
  const source = info['source_type']
  const type = info['device_type'] ?? info['antplus_device_type'] ?? info['ble_device_type']
  if (typeof source === 'string' && ANT_SOURCES.has(source)) {
    return isHeartRateType(type, ANT_HEART_RATE)
  }
  if (typeof source === 'string' && BLE_SOURCES.has(source)) {
    return isHeartRateType(type, BLE_HEART_RATE)
  }
  return false
}

/**
 * `strap` when the file lists an external heart-rate sensor, `wrist` when it lists devices and none
 * is one (the watch's own sensor), `unknown` when it lists no device at all.
 */
export function hrSourceOfDeviceInfos(infos: readonly Message[]): HrSource {
  if (infos.length === 0) return 'unknown'
  return infos.some(isHeartRateSensor) ? 'strap' : 'wrist'
}
