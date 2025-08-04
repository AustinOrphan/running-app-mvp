import { useLocation, useNavigate } from 'react-router';
import { useMemo } from 'react';

import { RouteKey, ROUTES, getActiveTabFromPath, getRouteByPath } from '../constants/navigation';

export interface RouterState {
  currentRoute: RouteKey;
  currentPath: string;
  navigate: (route: RouteKey) => void;
  isActive: (route: RouteKey) => boolean;
  routeConfig: (typeof ROUTES)[RouteKey] | null;
}

/**
 * Modern router hook that provides type-safe navigation and route state
 */
export const useRouter = (): RouterState => {
  const location = useLocation();
  const navigate = useNavigate();

  const currentRoute = useMemo(() => {
    return getActiveTabFromPath(location.pathname);
  }, [location.pathname]);

  const routeConfig = useMemo(() => {
    return getRouteByPath(location.pathname);
  }, [location.pathname]);

  const navigateToRoute = (route: RouteKey) => {
    const routeConfig = ROUTES[route];
    if (routeConfig) {
      navigate(routeConfig.path);
    }
  };

  const isActive = (route: RouteKey) => {
    return currentRoute === route;
  };

  return {
    currentRoute,
    currentPath: location.pathname,
    navigate: navigateToRoute,
    isActive,
    routeConfig,
  };
};
