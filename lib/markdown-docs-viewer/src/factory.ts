import { MarkdownDocsViewer } from './viewer';
import { DocumentationConfig, Document } from './types';

/**
 * Factory function to create a new documentation viewer instance
 */
export function createViewer(config: DocumentationConfig): MarkdownDocsViewer {
  return new MarkdownDocsViewer(config);
}

/**
 * Initialize viewer with minimal configuration
 */
export function quickStart(
  container: string | HTMLElement,
  documents: Document[]
): MarkdownDocsViewer {
  return createViewer({
    container,
    source: {
      type: 'content',
      documents,
    },
  });
}
