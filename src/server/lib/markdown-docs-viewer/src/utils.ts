/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Sanitize URL to prevent XSS attacks
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    // Only allow http, https, and relative URLs
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      url.startsWith('/') ||
      url.startsWith('./')
    ) {
      return url;
    }
    return '';
  } catch {
    // If URL parsing fails, assume it's a relative URL
    // but escape it to be safe
    return escapeHtml(url);
  }
}
