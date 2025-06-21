import { useState, useEffect } from 'react';
import { TAB_IDS, SWIPE_CONFIG } from '../constants/navigation';

export const useSwipeNavigation = (
  activeTab: string,
  onTabChange: (tab: string) => void,
  onSwipeHighlight: () => void
) => {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [hasSwipedOnce, setHasSwipedOnce] = useState(false);

  useEffect(() => {
    // Check if user has swiped before
    const hasSwipedBefore = localStorage.getItem('hasSwipedOnce');
    if (hasSwipedBefore === 'true') {
      setHasSwipedOnce(true);
    }
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (touchStart == null || touchEnd == null) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > SWIPE_CONFIG.minDistance;
    const isRightSwipe = distance < -SWIPE_CONFIG.minDistance;

    const currentTabIndex = TAB_IDS.indexOf(activeTab as any);
    
    if (isLeftSwipe && currentTabIndex < TAB_IDS.length - 1) {
      // Swipe left - go to next tab
      const nextTab = TAB_IDS[currentTabIndex + 1];
      onTabChange(nextTab);
      onSwipeHighlight();
      markAsSwipedOnce();
    }
    
    if (isRightSwipe && currentTabIndex > 0) {
      // Swipe right - go to previous tab
      const prevTab = TAB_IDS[currentTabIndex - 1];
      onTabChange(prevTab);
      onSwipeHighlight();
      markAsSwipedOnce();
    }
  };

  const markAsSwipedOnce = () => {
    if (!hasSwipedOnce) {
      setHasSwipedOnce(true);
      localStorage.setItem('hasSwipedOnce', 'true');
    }
  };

  return {
    hasSwipedOnce,
    onTouchStart,
    onTouchMove,
    onTouchEnd
  };
};