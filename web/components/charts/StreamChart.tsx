// Stub from the data-foundation scaffold; Task D15 builds the chart.
import type { ActivityStreamData } from '../../../shared/types.ts'

export interface StreamChartProps {
  stream: ActivityStreamData & { sampleSec: number }
  channel: 'pace' | 'hr' | 'alt'
}

export function StreamChart({ stream, channel }: StreamChartProps) {
  void stream
  void channel
  return null
}
