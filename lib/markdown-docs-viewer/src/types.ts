export interface Document {
  id: string;
  title: string;
  file?: string;
  content?: string;
  description?: string;
  category?: string;
  tags?: string[];
  order?: number;
}

export interface DocumentSource {
  type: 'local' | 'url' | 'github' | 'content';
  basePath?: string;
  baseUrl?: string;
  documents: Document[];
  headers?: Record<string, string>;
}

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    codeBackground: string;
    link: string;
    linkHover: string;
    error: string;
    warning: string;
    success: string;
  };
  fonts: {
    body: string;
    heading: string;
    code: string;
  };
  spacing: {
    unit: number;
    containerMaxWidth: string;
    sidebarWidth: string;
  };
  borderRadius: string;
  customCSS?: string;
}

export interface SearchOptions {
  enabled: boolean;
  placeholder?: string;
  caseSensitive?: boolean;
  fuzzySearch?: boolean;
  searchInTags?: boolean;
  maxResults?: number;
}

export interface NavigationOptions {
  showCategories: boolean;
  showTags: boolean;
  collapsible: boolean;
  showDescription: boolean;
  sortBy?: 'title' | 'order' | 'date';
}

export interface RenderOptions {
  syntaxHighlighting: boolean;
  highlightTheme?: string;
  copyCodeButton: boolean;
  linkTarget?: '_blank' | '_self';
  sanitizeHtml?: boolean;
  customRenderers?: Record<string, (content: string) => string>;
}

export interface DocumentationConfig {
  container: string | HTMLElement;
  source: DocumentSource;
  theme?: Theme;
  search?: SearchOptions;
  navigation?: NavigationOptions;
  render?: RenderOptions;
  title?: string;
  logo?: string;
  footer?: string;
  onDocumentLoad?: (doc: Document) => void;
  onError?: (error: Error) => void;
  responsive?: boolean;
  routing?: 'hash' | 'memory' | 'none';
}

export interface ViewerState {
  currentDocument: Document | null;
  documents: Document[];
  searchQuery: string;
  searchResults: Document[];
  loading: boolean;
  error: Error | null;
  sidebarOpen: boolean;
}
