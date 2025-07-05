import React from 'react';

export interface FooterInfoItem {
  label: string;
  value: string | number;
  variant?: 'normal' | 'error' | 'success' | 'warning';
}

export interface FooterSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

export interface FooterLink {
  label: string;
  href: string;
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Creates a footer section with a list of information items
 */
export const createInfoSection = (
  id: string,
  title: string,
  items: FooterInfoItem[]
): FooterSection => ({
  id,
  title,
  content: (
    <>
      {items.map((item, index) => (
        <div key={index} className={`footer-info-item ${item.variant || ''}`}>
          <span className='footer-info-label'>{item.label}:</span>
          <span className='footer-info-value'>{item.value}</span>
        </div>
      ))}
    </>
  ),
});

/**
 * Creates a footer section with custom React content
 */
export const createCustomSection = (
  id: string,
  title: string,
  content: React.ReactNode
): FooterSection => ({
  id,
  title,
  content,
});

/**
 * Creates standard app information section
 */
export const createAppInfoSection = (): FooterSection => {
  const appVersion = process.env.REACT_APP_VERSION || '1.0.0';
  const buildDate = process.env.REACT_APP_BUILD_DATE || new Date().toISOString().split('T')[0];
  const environment = process.env.NODE_ENV || 'development';

  return createInfoSection('app-info', 'App Info', [
    { label: 'Version', value: appVersion },
    { label: 'Build', value: buildDate },
    { label: 'Environment', value: environment },
  ]);
};

/**
 * Creates user statistics section (example of how to extend)
 */
export const createUserStatsSection = (stats: {
  totalRuns?: number;
  totalDistance?: number;
  totalTime?: number;
}): FooterSection => {
  const items: FooterInfoItem[] = [];

  if (stats.totalRuns !== undefined) {
    items.push({ label: 'Total Runs', value: stats.totalRuns });
  }
  if (stats.totalDistance !== undefined) {
    items.push({ label: 'Total Distance', value: `${stats.totalDistance.toFixed(1)} km` });
  }
  if (stats.totalTime !== undefined) {
    items.push({ label: 'Total Time', value: `${Math.floor(stats.totalTime / 60)}h ${stats.totalTime % 60}m` });
  }

  return createInfoSection('user-stats', 'Your Stats', items);
};

/**
 * Creates debug information section for development
 */
export const createDebugSection = (): FooterSection => {
  const userAgent = navigator.userAgent;
  const screenSize = `${window.screen.width}x${window.screen.height}`;
  const viewportSize = `${window.innerWidth}x${window.innerHeight}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return createInfoSection('debug', 'Debug Info', [
    { label: 'Screen', value: screenSize },
    { label: 'Viewport', value: viewportSize },
    { label: 'Timezone', value: timezone },
    { label: 'User Agent', value: userAgent.length > 50 ? `${userAgent.substring(0, 50)}...` : userAgent },
  ]);
};

/**
 * Creates system status section
 */
export const createSystemStatusSection = (data: {
  serverVersion?: string;
  databaseStatus?: 'connected' | 'disconnected' | 'unknown';
  cacheStatus?: 'enabled' | 'disabled';
  maintenanceMode?: boolean;
}): FooterSection => {
  const items: FooterInfoItem[] = [];

  if (data.serverVersion) {
    items.push({ label: 'Server Version', value: data.serverVersion });
  }

  if (data.databaseStatus) {
    items.push({
      label: 'Database',
      value: data.databaseStatus,
      variant: data.databaseStatus === 'connected' ? 'success' : 'error',
    });
  }

  if (data.cacheStatus) {
    items.push({
      label: 'Cache',
      value: data.cacheStatus,
      variant: data.cacheStatus === 'enabled' ? 'success' : 'warning',
    });
  }

  if (data.maintenanceMode !== undefined) {
    items.push({
      label: 'Maintenance',
      value: data.maintenanceMode ? 'Active' : 'Normal',
      variant: data.maintenanceMode ? 'warning' : 'success',
    });
  }

  return createInfoSection('system-status', 'System', items);
};

/**
 * Default footer links for the running app
 */
export const defaultFooterLinks: FooterLink[] = [
  {
    label: 'Privacy Policy',
    href: '/privacy',
    onClick: (e) => {
      e.preventDefault();
      // TODO: Implement privacy policy modal or navigation
      console.log('Privacy policy clicked');
    },
  },
  {
    label: 'Terms of Service',
    href: '/terms',
    onClick: (e) => {
      e.preventDefault();
      // TODO: Implement terms modal or navigation
      console.log('Terms of service clicked');
    },
  },
  {
    label: 'Help & Support',
    href: '/help',
    onClick: (e) => {
      e.preventDefault();
      // TODO: Implement help system
      console.log('Help & support clicked');
    },
  },
  {
    label: 'About',
    href: '/about',
    onClick: (e) => {
      e.preventDefault();
      // TODO: Implement about modal
      console.log('About clicked');
    },
  },
];

/**
 * Example of creating a comprehensive footer configuration
 */
export const createExampleFooterConfig = () => {
  const sections: FooterSection[] = [
    createAppInfoSection(),
    createUserStatsSection({
      totalRuns: 42,
      totalDistance: 156.7,
      totalTime: 720, // minutes
    }),
  ];

  // Add debug section in development
  if (process.env.NODE_ENV === 'development') {
    sections.push(createDebugSection());
  }

  return {
    sections,
    links: defaultFooterLinks,
  };
};
