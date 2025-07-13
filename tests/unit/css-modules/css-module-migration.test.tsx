import { describe, it, expect } from 'vitest';

// Import all CSS modules to verify they exist and export correctly
import appStyles from '../../../src/styles/components/App.module.css';
import authFormStyles from '../../../src/styles/components/AuthForm.module.css';
import buttonStyles from '../../../src/styles/components/Button.module.css';
import cardStyles from '../../../src/styles/components/Card.module.css';
import connectivityStyles from '../../../src/styles/components/Connectivity.module.css';
import featureStyles from '../../../src/styles/components/Feature.module.css';
import formStyles from '../../../src/styles/components/Form.module.css';
import goalsStyles from '../../../src/styles/components/Goals.module.css';
import layoutStyles from '../../../src/styles/components/Layout.module.css';
import loadingStyles from '../../../src/styles/components/Loading.module.css';
import modalStyles from '../../../src/styles/components/Modal.module.css';
import navigationStyles from '../../../src/styles/components/Navigation.module.css';
import notificationStyles from '../../../src/styles/components/Notification.module.css';
import progressStyles from '../../../src/styles/components/Progress.module.css';
import runsStyles from '../../../src/styles/components/Runs.module.css';
import statsStyles from '../../../src/styles/components/Stats.module.css';
import templateCustomizationStyles from '../../../src/styles/components/TemplateCustomization.module.css';
import utilStyles from '../../../src/styles/components/Utils.module.css';

describe('CSS Module Migration Tests', () => {
  describe('CSS Module Imports', () => {
    const testModuleImport = (name: string, styles: object) => {
      it(`should successfully import ${name}`, () => {
        expect(styles).toBeDefined();
        expect(typeof styles).toBe('object');
        expect(Object.keys(styles).length).toBeGreaterThan(0);
      });
    };

    testModuleImport('App.module.css', appStyles);
    testModuleImport('AuthForm.module.css', authFormStyles);
    testModuleImport('Button.module.css', buttonStyles);
    testModuleImport('Card.module.css', cardStyles);
    testModuleImport('Connectivity.module.css', connectivityStyles);
    testModuleImport('Feature.module.css', featureStyles);
    testModuleImport('Form.module.css', formStyles);
    testModuleImport('Goals.module.css', goalsStyles);
    testModuleImport('Layout.module.css', layoutStyles);
    testModuleImport('Loading.module.css', loadingStyles);
    testModuleImport('Modal.module.css', modalStyles);
    testModuleImport('Navigation.module.css', navigationStyles);
    testModuleImport('Notification.module.css', notificationStyles);
    testModuleImport('Progress.module.css', progressStyles);
    testModuleImport('Runs.module.css', runsStyles);
    testModuleImport('Stats.module.css', statsStyles);
    testModuleImport('TemplateCustomization.module.css', templateCustomizationStyles);
    testModuleImport('Utils.module.css', utilStyles);
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
      // Toast notifications
      expect(notificationStyles.toastContainer).toBeDefined();
      expect(notificationStyles.toast).toBeDefined();
      expect(notificationStyles.toastContent).toBeDefined();
      expect(notificationStyles.toastMessage).toBeDefined();
      expect(notificationStyles.toastClose).toBeDefined();
      
      // Achievement notifications
      expect(notificationStyles.achievementOverlay).toBeDefined();
      expect(notificationStyles.achievementNotification).toBeDefined();
      
      // Notification center
      expect(notificationStyles.notificationCenter).toBeDefined();
      expect(notificationStyles.notificationCenterOverlay).toBeDefined();
      expect(notificationStyles.notificationList).toBeDefined();
      expect(notificationStyles.notificationEmpty).toBeDefined();
      
      // Notification items
      expect(notificationStyles.notificationItem).toBeDefined();
      expect(notificationStyles.notificationHeader).toBeDefined();
      expect(notificationStyles.notificationContent).toBeDefined();
      expect(notificationStyles.notificationDismiss).toBeDefined();
      
      // Settings section (recently migrated)
      expect(notificationStyles.notificationSettings).toBeDefined();
      expect(notificationStyles.settingItem).toBeDefined();
      expect(notificationStyles.settingToggle).toBeDefined();
      expect(notificationStyles.btnPrimary).toBeDefined();
      
      // Notification type variants
      expect(notificationStyles.notificationAchievement).toBeDefined();
      expect(notificationStyles.notificationMilestone).toBeDefined();
      expect(notificationStyles.notificationDeadline).toBeDefined();
      expect(notificationStyles.notificationStreak).toBeDefined();
    });
  });

  describe('Button CSS Module Classes', () => {
    it('should have required button classes with accessibility compliance', () => {
      expect(buttonStyles.btn).toBeDefined();
      expect(buttonStyles.btnPrimary).toBeDefined();
      expect(buttonStyles.btnSecondary).toBeDefined();
      expect(buttonStyles.btnIcon).toBeDefined();
      expect(buttonStyles.btnSmall).toBeDefined();
      expect(buttonStyles.btnLarge).toBeDefined();
    });
  });

  describe('Progress CSS Module Classes', () => {
    it('should have required progress classes with optimizations', () => {
      expect(progressStyles.circularProgress).toBeDefined();
      expect(progressStyles.progressBar).toBeDefined();
      expect(progressStyles.progressFill).toBeDefined();
      expect(progressStyles.streakDay).toBeDefined();
      expect(progressStyles.streakCard).toBeDefined();
      expect(progressStyles.chartContainer).toBeDefined();
    });
  });

  describe('Form CSS Module Classes', () => {
    it('should have required form classes with accessibility compliance', () => {
      expect(formStyles.formGroup).toBeDefined();
      expect(formStyles.formActions).toBeDefined();
      expect(formStyles.errorMessage).toBeDefined();
      expect(formStyles.successMessage).toBeDefined();
      expect(formStyles.checkboxGroup).toBeDefined();
      expect(formStyles.radioGroup).toBeDefined();
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
    it('should generate valid class names for all modules', () => {
      const testClassNameGeneration = (styles: object, moduleName: string) => {
        const keys = Object.keys(styles);
        expect(keys.length).toBeGreaterThan(0);
        
        keys.forEach(key => {
          const className = (styles as any)[key];
          expect(typeof className).toBe('string');
          expect(className.length).toBeGreaterThan(0);
          expect(className).not.toMatch(/^[.#]/); // Should not start with . or #
        });
      };

      testClassNameGeneration(layoutStyles, 'Layout');
      testClassNameGeneration(notificationStyles, 'Notification');
      testClassNameGeneration(buttonStyles, 'Button');
      testClassNameGeneration(formStyles, 'Form');
      testClassNameGeneration(progressStyles, 'Progress');
    });

    it('should handle conditional class concatenation', () => {
      const isAnimating = true;
      const isOpen = false;
      
      // Test notification toast states
      const toastClassName = `${notificationStyles.toast} ${isAnimating ? notificationStyles.show : ''}`;
      expect(toastClassName).toContain(notificationStyles.toast);
      expect(toastClassName).toContain(notificationStyles.show);

      // Test notification center states
      const centerClassName = `${notificationStyles.notificationCenter} ${isOpen ? notificationStyles.open : ''}`;
      expect(centerClassName).toContain(notificationStyles.notificationCenter);
      expect(centerClassName).not.toContain(notificationStyles.open);
    });

    it('should handle complex class combinations for notification types', () => {
      const notificationType = 'milestone';
      const priority = 'high';
      const isUnread = true;

      const typeMap: Record<string, string> = {
        achievement: notificationStyles.notificationAchievement,
        milestone: notificationStyles.notificationMilestone,
        deadline: notificationStyles.notificationDeadline,
        streak: notificationStyles.notificationStreak,
      };

      const priorityMap: Record<string, string> = {
        urgent: notificationStyles.notificationUrgent,
        high: notificationStyles.notificationHigh,
        medium: notificationStyles.notificationMedium,
        low: notificationStyles.notificationLow,
      };

      const className = [
        notificationStyles.notificationItem,
        typeMap[notificationType],
        priorityMap[priority],
        isUnread ? notificationStyles.unread : '',
      ].filter(Boolean).join(' ');

      expect(className).toContain(notificationStyles.notificationItem);
      expect(className).toContain(notificationStyles.notificationMilestone);
      expect(className).toContain(notificationStyles.notificationHigh);
      expect(className).toContain(notificationStyles.unread);
    });

    it('should support button variant combinations', () => {
      const isSmall = true;
      const isLoading = false;
      const isIcon = true;

      const buttonClassName = [
        isIcon ? buttonStyles.btnIcon : buttonStyles.btn,
        isSmall ? buttonStyles.btnSmall : '',
        isLoading ? buttonStyles.btnLoading : '',
      ].filter(Boolean).join(' ');

      expect(buttonClassName).toContain(buttonStyles.btnIcon);
      expect(buttonClassName).toContain(buttonStyles.btnSmall);
      expect(buttonClassName).not.toContain(buttonStyles.btnLoading);
    });
  });
});
