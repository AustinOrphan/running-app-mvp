export const TAB_CONFIG = [
  { id: 'runs', label: '📊 Runs' },
  { id: 'goals', label: '🎯 Goals' },
  { id: 'races', label: '🏆 Races' },
  { id: 'stats', label: '📈 Stats' },
] as const;

// Route and navigation types
export type RouteKey = 'runs' | 'goals' | 'races' | 'stats';

export interface RouteConfig {
  key: RouteKey;
  path: string;
  label: string;
  icon: string;
  component: string;
}

// Route configuration
export const ROUTES: Record<RouteKey, RouteConfig> = {
  runs: {
    key: 'runs',
    path: '/runs',
    label: 'Runs',
    icon: '🏃‍♂️',
    component: 'RunsPage',
  },
  goals: {
    key: 'goals',
    path: '/goals',
    label: 'Goals',
    icon: '🎯',
    component: 'GoalsPage',
  },
  races: {
    key: 'races',
    path: '/races',
    label: 'Races',
    icon: '🏆',
    component: 'ComingSoonPage',
  },
  stats: {
    key: 'stats',
    path: '/stats',
    label: 'Stats',
    icon: '📊',
    component: 'StatsPage',
  },
} as const;

// Helper to get route by path
export const getRouteByPath = (pathname: string): RouteConfig | null => {
  const routeKey = Object.keys(ROUTES).find(key => ROUTES[key as RouteKey].path === pathname) as
    | RouteKey
    | undefined;

  return routeKey ? ROUTES[routeKey] : null;
};

// Helper to get active tab from pathname
export const getActiveTabFromPath = (pathname: string): RouteKey => {
  const route = getRouteByPath(pathname);
  if (route) return route.key;

  // Handle base path and fallback
  if (pathname === '/') return 'runs';

  // Try to extract from path segments - more robust for nested routes
  const segment = pathname.split('/').find(Boolean);
  const firstSegment = segment as RouteKey;

  return TAB_IDS.includes(firstSegment) ? firstSegment : 'runs';
};

export const TAB_IDS = ['runs', 'goals', 'races', 'stats'] as const;

export const SWIPE_CONFIG = {
  minDistance: 50,
} as const;
