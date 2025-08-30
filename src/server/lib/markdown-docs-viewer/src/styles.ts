import { Theme, DocumentationConfig } from './types';

export function generateStyles(theme: Theme, _config: DocumentationConfig): string {
  const { colors, fonts, spacing, borderRadius } = theme;
  const unit = spacing.unit;

  return `
    /* Base Styles */
    .mdv-app {
      font-family: ${fonts.body};
      color: ${colors.textPrimary};
      background-color: ${colors.background};
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .mdv-app * {
      box-sizing: border-box;
    }

    /* Header */
    .mdv-header {
      background-color: ${colors.surface};
      border-bottom: 1px solid ${colors.border};
      padding: ${unit * 2}px ${unit * 3}px;
      display: flex;
      align-items: center;
      gap: ${unit * 2}px;
    }

    .mdv-mobile-toggle {
      display: none;
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: ${colors.textPrimary};
      padding: ${unit}px;
    }

    .mdv-logo {
      height: 32px;
      width: auto;
    }

    .mdv-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: ${colors.primary};
      margin: 0;
    }

    /* Layout */
    .mdv-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* Sidebar */
    .mdv-sidebar {
      width: ${spacing.sidebarWidth};
      background-color: ${colors.surface};
      border-right: 1px solid ${colors.border};
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform 0.3s ease;
    }

    /* Search */
    .mdv-search {
      padding: ${unit * 2}px;
      border-bottom: 1px solid ${colors.border};
    }

    .mdv-search-input {
      width: 100%;
      padding: ${unit * 1.5}px ${unit * 2}px;
      background-color: ${colors.background};
      border: 1px solid ${colors.border};
      border-radius: ${borderRadius};
      color: ${colors.textPrimary};
      font-size: 0.875rem;
      transition: border-color 0.2s;
    }

    .mdv-search-input:focus {
      outline: none;
      border-color: ${colors.primary};
      box-shadow: 0 0 0 3px ${colors.primary}33;
    }

    /* Navigation */
    .mdv-navigation {
      flex: 1;
      overflow-y: auto;
      padding: ${unit}px 0;
    }

    .mdv-nav-list,
    .mdv-nav-sublist {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .mdv-nav-group {
      margin-bottom: ${unit}px;
    }

    .mdv-nav-category {
      padding: ${unit}px ${unit * 2}px;
      font-weight: 600;
      color: ${colors.textSecondary};
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }

    .mdv-nav-category.collapsible:hover {
      color: ${colors.textPrimary};
    }

    .mdv-collapse-icon {
      transition: transform 0.2s;
    }

    .mdv-nav-item {
      margin: ${unit * 0.5}px ${unit}px;
    }

    .mdv-nav-link {
      display: block;
      padding: ${unit * 1.5}px ${unit * 2}px;
      color: ${colors.textSecondary};
      text-decoration: none;
      border-radius: ${borderRadius};
      transition: all 0.2s;
    }

    .mdv-nav-link:hover {
      background-color: ${colors.background};
      color: ${colors.textPrimary};
      transform: translateX(4px);
    }

    .mdv-nav-link.active {
      background-color: ${colors.primary};
      color: white;
    }

    .mdv-nav-title {
      font-weight: 500;
      display: block;
    }

    .mdv-nav-description {
      font-size: 0.75rem;
      margin-top: ${unit * 0.5}px;
      opacity: 0.8;
    }

    .mdv-nav-tags {
      display: flex;
      flex-wrap: wrap;
      gap: ${unit * 0.5}px;
      margin-top: ${unit * 0.5}px;
    }

    .mdv-tag {
      font-size: 0.625rem;
      padding: ${unit * 0.25}px ${unit * 0.75}px;
      background-color: ${colors.primary}22;
      color: ${colors.primary};
      border-radius: ${borderRadius};
    }

    /* Content */
    .mdv-content {
      flex: 1;
      overflow-y: auto;
      background-color: ${colors.background};
    }

    .mdv-document {
      max-width: ${spacing.containerMaxWidth};
      margin: 0 auto;
      padding: ${unit * 4}px;
    }

    .mdv-document-title {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: ${unit * 4}px;
      color: ${colors.textPrimary};
      font-family: ${fonts.heading};
    }

    /* Markdown Content */
    .mdv-document-content {
      font-size: 1rem;
      line-height: 1.7;
      color: ${colors.textSecondary};
    }

    .mdv-document-content h1,
    .mdv-document-content h2,
    .mdv-document-content h3,
    .mdv-document-content h4,
    .mdv-document-content h5,
    .mdv-document-content h6 {
      font-family: ${fonts.heading};
      font-weight: 600;
      margin-top: ${unit * 3}px;
      margin-bottom: ${unit * 2}px;
      color: ${colors.textPrimary};
    }

    .mdv-document-content h1 { font-size: 2rem; }
    .mdv-document-content h2 { font-size: 1.5rem; }
    .mdv-document-content h3 { font-size: 1.25rem; }
    .mdv-document-content h4 { font-size: 1.125rem; }

    .mdv-document-content p {
      margin-bottom: ${unit * 2}px;
    }

    .mdv-document-content a {
      color: ${colors.link};
      text-decoration: none;
      transition: color 0.2s;
    }

    .mdv-document-content a:hover {
      color: ${colors.linkHover};
      text-decoration: underline;
    }

    .mdv-document-content ul,
    .mdv-document-content ol {
      margin-bottom: ${unit * 2}px;
      padding-left: ${unit * 4}px;
    }

    .mdv-document-content li {
      margin-bottom: ${unit}px;
    }

    .mdv-document-content code {
      font-family: ${fonts.code};
      font-size: 0.875em;
      padding: ${unit * 0.25}px ${unit * 0.75}px;
      background-color: ${colors.codeBackground};
      border-radius: ${borderRadius};
    }

    .mdv-code-block {
      position: relative;
      margin-bottom: ${unit * 2}px;
    }

    .mdv-document-content pre {
      background-color: ${colors.codeBackground};
      padding: ${unit * 2}px;
      border-radius: ${borderRadius};
      overflow-x: auto;
      margin: 0;
    }

    .mdv-document-content pre code {
      background: none;
      padding: 0;
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .mdv-copy-button {
      position: absolute;
      top: ${unit}px;
      right: ${unit}px;
      padding: ${unit * 0.5}px ${unit * 1.5}px;
      background-color: ${colors.primary};
      color: white;
      border: none;
      border-radius: ${borderRadius};
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mdv-copy-button:hover {
      background-color: ${colors.secondary};
    }

    .mdv-document-content blockquote {
      border-left: 4px solid ${colors.primary};
      padding-left: ${unit * 2}px;
      margin: ${unit * 2}px 0;
      color: ${colors.textSecondary};
      font-style: italic;
    }

    .mdv-document-content table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: ${unit * 2}px;
    }

    .mdv-document-content th,
    .mdv-document-content td {
      padding: ${unit * 1.5}px;
      text-align: left;
      border-bottom: 1px solid ${colors.border};
    }

    .mdv-document-content th {
      background-color: ${colors.surface};
      font-weight: 600;
      color: ${colors.textPrimary};
    }

    .mdv-document-content hr {
      border: none;
      border-top: 1px solid ${colors.border};
      margin: ${unit * 4}px 0;
    }

    /* States */
    .mdv-loading,
    .mdv-error,
    .mdv-welcome {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 1.125rem;
      color: ${colors.textSecondary};
    }

    .mdv-error {
      color: ${colors.error};
    }

    /* Footer */
    .mdv-footer {
      background-color: ${colors.surface};
      border-top: 1px solid ${colors.border};
      padding: ${unit * 2}px ${unit * 3}px;
      text-align: center;
      color: ${colors.textSecondary};
      font-size: 0.875rem;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .mdv-mobile-toggle {
        display: block;
      }

      .mdv-sidebar {
        position: fixed;
        left: 0;
        top: 0;
        height: 100vh;
        z-index: 1000;
        transform: translateX(-100%);
        box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
      }

      .mdv-sidebar.open {
        transform: translateX(0);
      }

      .mdv-document {
        padding: ${unit * 2}px;
      }

      .mdv-document-title {
        font-size: 2rem;
      }
    }

    /* Scrollbar */
    .mdv-navigation::-webkit-scrollbar,
    .mdv-content::-webkit-scrollbar {
      width: 8px;
    }

    .mdv-navigation::-webkit-scrollbar-track,
    .mdv-content::-webkit-scrollbar-track {
      background: ${colors.background};
    }

    .mdv-navigation::-webkit-scrollbar-thumb,
    .mdv-content::-webkit-scrollbar-thumb {
      background: ${colors.border};
      border-radius: 4px;
    }

    .mdv-navigation::-webkit-scrollbar-thumb:hover,
    .mdv-content::-webkit-scrollbar-thumb:hover {
      background: ${colors.textSecondary};
    }

    /* Syntax highlighting overrides */
    .hljs {
      background: transparent !important;
      color: ${colors.textPrimary} !important;
    }

    /* Custom CSS */
    ${theme.customCSS || ''}
  `;
}
