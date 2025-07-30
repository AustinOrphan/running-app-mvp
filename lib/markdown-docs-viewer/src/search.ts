import { SearchOptions } from './types';
import { escapeHtml } from './utils';

export function createSearch(options: SearchOptions): string {
  return `
    <div class="mdv-search">
      <input 
        type="text" 
        class="mdv-search-input" 
        placeholder="${escapeHtml(options.placeholder || 'Search documentation...')}"
        aria-label="Search documentation"
      />
      <div class="mdv-search-results"></div>
    </div>
  `;
}
