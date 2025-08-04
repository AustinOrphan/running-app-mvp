import React, { useState, useEffect } from 'react';

interface ProgressiveLoaderProps {
  children: React.ReactNode;
  loading: boolean;
  skeleton: React.ReactNode;
  delay?: number;
  enableStagger?: boolean;
}

export const ProgressiveLoader: React.FC<ProgressiveLoaderProps> = ({
  children,
  loading,
  skeleton,
  delay = 0,
  enableStagger = false,
}) => {
  const [showContent, setShowContent] = useState(!loading);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (!loading && !showContent) {
      // Add delay for staggered loading effect
      const timeout = setTimeout(
        () => {
          setIsTransitioning(true);
          // Small delay for transition effect
          setTimeout(() => {
            setShowContent(true);
            setIsTransitioning(false);
          }, 50);
        },
        enableStagger ? delay : 0
      );

      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [loading, showContent, delay, enableStagger]);

  useEffect(() => {
    if (loading) {
      setShowContent(false);
      setIsTransitioning(false);
    }
  }, [loading]);

  if (loading || !showContent) {
    return (
      <div
        className={`progressive-loader-skeleton ${isTransitioning ? 'transitioning' : ''}`}
        style={{
          opacity: isTransitioning ? 0 : 1,
          transition: 'opacity 0.3s ease-out',
        }}
      >
        {skeleton}
      </div>
    );
  }

  return (
    <div
      className='progressive-loader-content'
      style={{
        animation: 'fadeInScale 0.5s ease-out',
      }}
    >
      {children}
      <style>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.98);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .progressive-loader-content {
          animation-fill-mode: both;
        }

        .progressive-loader-skeleton.transitioning {
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .progressive-loader-content {
            animation: none;
          }
          
          @keyframes fadeInScale {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
};

// Hook for managing progressive loading states
export const useProgressiveLoading = (totalItems: number, baseDelay: number = 100) => {
  const [loadedItems, setLoadedItems] = useState<Set<number>>(new Set());

  const markAsLoaded = (index: number) => {
    setLoadedItems(prev => new Set([...prev, index]));
  };

  const isLoaded = (index: number) => loadedItems.has(index);

  const getDelay = (index: number) => index * baseDelay;

  const reset = () => setLoadedItems(new Set());

  return {
    markAsLoaded,
    isLoaded,
    getDelay,
    reset,
    allLoaded: loadedItems.size === totalItems,
  };
};
