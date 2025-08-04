/**
 * CSS Utility Functions for styled-components migration
 * Based on styled-components best practices
 */

// Media Query Utilities
const sizes = {
  giant: 1170,
  desktop: 992,
  tablet: 768,
  phone: 376,
} as const;

// Generate media query helpers
export const media = Object.keys(sizes).reduce(
  (accumulator, label) => {
    const key = label as keyof typeof sizes;
    // Use em in breakpoints for better cross-browser support
    const emSize = sizes[key] / 16;
    accumulator[key] = (styles: string) => `
    @media (max-width: ${emSize}em) {
      ${styles}
    }
  `;
    return accumulator;
  },
  {} as Record<keyof typeof sizes, (styles: string) => string>
);

// Text Truncation Utility
export function truncate(width: string) {
  return `
    width: ${width};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
}

// Flex Utilities
export const flexCenter = `
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const flexBetween = `
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

export const flexColumn = `
  display: flex;
  flex-direction: column;
`;

// Animation Utilities
export const fadeIn = `
  animation: fadeIn 0.3s ease-in-out;
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

export const slideUp = `
  animation: slideUp 0.3s ease-out;
  
  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px); 
    }
    to { 
      opacity: 1;
      transform: translateY(0); 
    }
  }
`;

// Button Mixins
export function buttonVariant(backgroundColor: string, hoverColor: string, textColor = 'white') {
  return `
    background: ${backgroundColor};
    color: ${textColor};
    border: none;
    padding: 10px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s, transform 0.1s;
    
    &:hover:not(:disabled) {
      background: ${hoverColor};
      transform: translateY(-1px);
    }
    
    &:active {
      transform: translateY(0);
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
  `;
}

// Card Utilities
export const cardBase = `
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`;

export const cardHover = `
  ${cardBase}
  transition: transform 0.2s, box-shadow 0.2s;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }
`;

// Form Utilities
export const inputBase = `
  width: 100%;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-size: 0.9rem;
  box-sizing: border-box;
  transition: border-color 0.2s, background-color 0.2s;
  
  &:focus {
    outline: none;
    border-color: #3b82f6;
    background: #1a1a1a;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--primary-bg);
  }
`;

// Error Styling
export const errorState = `
  color: #ef4444;
  border-color: #ef4444;
`;

export const successState = `
  color: #10b981;
  border-color: #10b981;
`;

// Loading State
export const loadingSpinner = `
  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
`;

// Responsive Typography
export function responsiveText(desktopSize: string, mobileSize: string) {
  return `
    font-size: ${desktopSize};
    
    ${media.tablet(`
      font-size: ${mobileSize};
    `)}
  `;
}

// Z-index scale
export const zIndex = {
  dropdown: 1000,
  modal: 1050,
  toast: 1100,
  tooltip: 1200,
} as const;
