export const TAB_CONFIG = [
  { id: 'runs', label: '📊 Runs' },
  { id: 'goals', label: '🎯 Goals' },
  { id: 'races', label: '🏆 Races' },
  { id: 'stats', label: '📈 Stats' }
] as const;

export const TAB_IDS = ['runs', 'goals', 'races', 'stats'] as const;

export const SWIPE_CONFIG = {
  minDistance: 50
} as const;