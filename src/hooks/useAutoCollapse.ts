import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Custom hook for auto-collapse functionality with visual countdown
 * Extracted from ConnectivityFooter for better separation of concerns
 */
export const useAutoCollapse = (
  isExpanded: boolean,
  isMouseOver: boolean,
  onCollapse: () => void
) => {
  const [countdownProgress, setCountdownProgress] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [isAutoClosing, setIsAutoClosing] = useState(false);
  const autoCollapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear any existing auto-collapse timeout and countdown
  const clearAutoCollapseTimeout = useCallback(() => {
    if (autoCollapseTimeoutRef.current) {
      clearTimeout(autoCollapseTimeoutRef.current);
      autoCollapseTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdownProgress(0);
  }, []);

  // Reset countdown smoothly using CSS transition
  const resetCountdown = useCallback(() => {
    clearAutoCollapseTimeout();
    setIsResetting(true);
    setCountdownProgress(0);
    // Reset the resetting flag after animation completes
    setTimeout(() => {
      setIsResetting(false);
    }, 300);
  }, [clearAutoCollapseTimeout]);

  // Schedule auto-collapse after 3 seconds with visual countdown
  const scheduleAutoCollapse = useCallback(() => {
    clearAutoCollapseTimeout();

    const countdownDuration = 3000; // 3 seconds
    const updateInterval = 50; // Update every 50ms for smooth animation
    const startTime = Date.now();

    // Start countdown animation
    const countdownInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / countdownDuration, 1);
      setCountdownProgress(progress);

      if (progress >= 1) {
        clearInterval(countdownInterval);
      }
    }, updateInterval);
    countdownIntervalRef.current = countdownInterval;
    setIsResetting(false);

    // Set main timeout to close footer
    const timeout = setTimeout(() => {
      setIsAutoClosing(true);
      onCollapse();
      // Reset states after footer closes
      setTimeout(() => {
        setCountdownProgress(0);
        setIsAutoClosing(false);
      }, 300); // Match footer close animation duration
    }, countdownDuration);
    autoCollapseTimeoutRef.current = timeout;
  }, [clearAutoCollapseTimeout, onCollapse]);

  // Effect to handle auto-collapse scheduling
  useEffect(() => {
    if (isExpanded && !isMouseOver) {
      scheduleAutoCollapse();
    } else {
      clearAutoCollapseTimeout();
    }
  }, [isExpanded, isMouseOver, scheduleAutoCollapse, clearAutoCollapseTimeout]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearAutoCollapseTimeout();
    };
  }, [clearAutoCollapseTimeout]);

  return {
    countdownProgress,
    isResetting,
    isAutoClosing,
    resetCountdown,
    scheduleAutoCollapse,
    setIsAutoClosing,
    setCountdownProgress,
  };
};
