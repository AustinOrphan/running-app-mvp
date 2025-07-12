import { describe, it, expect } from 'vitest';

// Import the CSS modules to verify they exist and export correctly
import layoutStyles from '../../../src/styles/components/Layout.module.css';
import notificationStyles from '../../../src/styles/components/Notification.module.css';
import utilStyles from '../../../src/styles/components/Utils.module.css';

describe('CSS Module Migration Tests', () => {
  describe('CSS Module Imports', () => {
    it('should successfully import Layout.module.css', () => {
      expect(layoutStyles).toBeDefined();
      expect(typeof layoutStyles).toBe('object');
    });

    it('should successfully import Notification.module.css', () => {
      expect(notificationStyles).toBeDefined();
      expect(typeof notificationStyles).toBe('object');
    });

    it('should successfully import Utils.module.css', () => {
      expect(utilStyles).toBeDefined();
      expect(typeof utilStyles).toBe('object');
    });
  });

  describe('Layout CSS Module Classes', () => {
    it('should have required layout classes', () => {
      expect(layoutStyles.app).toBeDefined();
      expect(layoutStyles.dashboard).toBeDefined();
      expect(layoutStyles.tabContent).toBeDefined();
      expect(layoutStyles.offlineNotice).toBeDefined();
      expect(layoutStyles.footerSectionContent).toBeDefined();
      expect(layoutStyles.footerInfoItem).toBeDefined();
      expect(layoutStyles.footerInfoLabel).toBeDefined();
      expect(layoutStyles.footerInfoValue).toBeDefined();
    });
  });

  describe('Notification CSS Module Classes', () => {
    it('should have required notification classes', () => {
      expect(notificationStyles.toastContainer).toBeDefined();
      expect(notificationStyles.toast).toBeDefined();
      expect(notificationStyles.toastContent).toBeDefined();
      expect(notificationStyles.toastMessage).toBeDefined();
      expect(notificationStyles.toastClose).toBeDefined();
      expect(notificationStyles.achievementOverlay).toBeDefined();
      expect(notificationStyles.achievementNotification).toBeDefined();
    });
  });

  describe('Utils CSS Module Classes', () => {
    it('should have required utility classes', () => {
      expect(utilStyles.skeleton).toBeDefined();
      expect(utilStyles.skeletonText).toBeDefined();
      expect(utilStyles.skeletonLine).toBeDefined();
      expect(utilStyles.loading).toBeDefined();
      expect(utilStyles.fadeIn).toBeDefined();
      expect(utilStyles.slideIn).toBeDefined();
    });
  });

  describe('CSS Module Class Name Generation', () => {
    it('should generate valid class names for layout styles', () => {
      // CSS modules should generate class names (not be undefined)
      expect(typeof layoutStyles.app).toBe('string');
      expect(layoutStyles.app.length).toBeGreaterThan(0);

      expect(typeof layoutStyles.dashboard).toBe('string');
      expect(layoutStyles.dashboard.length).toBeGreaterThan(0);
    });

    it('should handle conditional class concatenation', () => {
      const isAnimating = true;
      const className = `${notificationStyles.toast} ${isAnimating ? notificationStyles.show : ''}`;

      expect(className).toContain(notificationStyles.toast);
      expect(className).toContain(notificationStyles.show);
    });
  });
});
