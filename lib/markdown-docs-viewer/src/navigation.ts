import { Document, NavigationOptions } from './types';

export function createNavigation(
  documents: Document[],
  currentDoc: Document | null,
  options: NavigationOptions
): string {
  // Group documents by category if enabled
  const grouped = options.showCategories
    ? groupByCategory(documents)
    : { 'All Documents': documents };

  // Sort documents
  const sortedGroups = Object.entries(grouped).map(([category, docs]) => ({
    category,
    documents: sortDocuments(docs, options.sortBy || 'order'),
  }));

  return `
    <ul class="mdv-nav-list">
      ${sortedGroups.map(group => renderGroup(group, currentDoc, options)).join('')}
    </ul>
  `;
}

function groupByCategory(documents: Document[]): Record<string, Document[]> {
  return documents.reduce(
    (acc, doc) => {
      const category = doc.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(doc);
      return acc;
    },
    {} as Record<string, Document[]>
  );
}

function sortDocuments(documents: Document[], sortBy: string): Document[] {
  return [...documents].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title);
      case 'order':
        return (a.order || 999) - (b.order || 999);
      default:
        return 0;
    }
  });
}

function renderGroup(
  group: { category: string; documents: Document[] },
  currentDoc: Document | null,
  options: NavigationOptions
): string {
  const isCollapsible = options.collapsible && group.documents.length > 1;

  return `
    <li class="mdv-nav-group">
      ${
        group.category !== 'All Documents'
          ? `
        <div class="mdv-nav-category ${isCollapsible ? 'collapsible' : ''}">
          ${group.category}
          ${isCollapsible ? '<span class="mdv-collapse-icon">▼</span>' : ''}
        </div>
      `
          : ''
      }
      <ul class="mdv-nav-sublist">
        ${group.documents.map(doc => renderDocument(doc, currentDoc, options)).join('')}
      </ul>
    </li>
  `;
}

function renderDocument(
  doc: Document,
  currentDoc: Document | null,
  options: NavigationOptions
): string {
  const isActive = currentDoc?.id === doc.id;
  const tags = options.showTags && doc.tags ? renderTags(doc.tags) : '';
  const description =
    options.showDescription && doc.description
      ? `<div class="mdv-nav-description">${doc.description}</div>`
      : '';

  return `
    <li class="mdv-nav-item">
      <a href="#${doc.id}" 
         class="mdv-nav-link ${isActive ? 'active' : ''}"
         data-doc-id="${doc.id}">
        <span class="mdv-nav-title">${doc.title}</span>
        ${description}
        ${tags}
      </a>
    </li>
  `;
}

function renderTags(tags: string[]): string {
  return `
    <div class="mdv-nav-tags">
      ${tags.map(tag => `<span class="mdv-tag">${tag}</span>`).join('')}
    </div>
  `;
}
