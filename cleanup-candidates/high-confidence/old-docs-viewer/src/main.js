import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// Configure marked with syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

// Documentation structure
const DOCUMENTS = [
  {
    id: 'whitepaper',
    title: 'Training System Whitepaper',
    file: 'training-system-whitepaper.md',
    description: 'Comprehensive overview of the science-based training system',
  },
  {
    id: 'references',
    title: 'Scientific References',
    file: 'training-science-references.md',
    description: 'Primary sources and research papers',
  },
  {
    id: 'implementation',
    title: 'Implementation Guide',
    file: 'training-implementation-guide.md',
    description: 'Code-to-science mapping and technical details',
  },
  {
    id: 'calculations',
    title: 'Calculations Reference',
    file: 'training-calculations-reference.md',
    description: 'Quick reference for all formulas and algorithms',
  },
  {
    id: 'bibliography',
    title: 'Complete Bibliography',
    file: 'training-bibliography.md',
    description: 'Full list of 40+ sources and citations',
  },
];

class DocumentationViewer {
  constructor() {
    this.currentDoc = null;
    this.documents = new Map();
    this.searchIndex = new Map();

    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    this.renderNavigation();
    await this.loadAllDocuments();

    // Load first document or from URL hash
    const hash = window.location.hash.slice(1);
    const docToLoad = hash || DOCUMENTS[0].id;
    this.loadDocument(docToLoad);
  }

  bindElements() {
    this.elements = {
      sidebar: document.getElementById('sidebar'),
      navList: document.getElementById('nav-list'),
      content: document.getElementById('content'),
      docTitle: document.getElementById('doc-title'),
      docContent: document.getElementById('doc-content'),
      searchInput: document.getElementById('search-input'),
      mobileToggle: document.getElementById('mobile-toggle'),
    };
  }

  bindEvents() {
    // Search functionality
    this.elements.searchInput.addEventListener('input', e => {
      this.handleSearch(e.target.value);
    });

    // Mobile menu toggle
    this.elements.mobileToggle.addEventListener('click', () => {
      this.elements.sidebar.classList.toggle('open');
    });

    // Close mobile menu on content click
    this.elements.content.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        this.elements.sidebar.classList.remove('open');
      }
    });

    // Handle browser navigation
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        this.loadDocument(hash);
      }
    });
  }

  renderNavigation() {
    this.elements.navList.innerHTML = DOCUMENTS.map(
      doc => `
      <li class="nav-item">
        <a href="#${doc.id}" class="nav-link" data-doc="${doc.id}">
          <div class="nav-link-title">${doc.title}</div>
          <div class="nav-link-desc">${doc.description}</div>
        </a>
      </li>
    `
    ).join('');

    // Add click handlers
    this.elements.navList.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const docId = link.dataset.doc;
        this.loadDocument(docId);
        window.location.hash = docId;

        // Close mobile menu
        if (window.innerWidth <= 768) {
          this.elements.sidebar.classList.remove('open');
        }
      });
    });
  }

  async loadAllDocuments() {
    // Pre-load all documents for search functionality
    for (const doc of DOCUMENTS) {
      try {
        const response = await fetch(`/docs/${doc.file}`);
        const content = await response.text();
        this.documents.set(doc.id, content);
        this.buildSearchIndex(doc.id, content);
      } catch (error) {
        console.error(`Failed to load ${doc.file}:`, error);
      }
    }
  }

  buildSearchIndex(docId, content) {
    // Simple search index - split content into searchable chunks
    const lines = content.split('\n');
    const chunks = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.trim()) {
        chunks.push({
          docId,
          lineNum: i,
          text: line,
          original: lines[i],
        });
      }
    }

    this.searchIndex.set(docId, chunks);
  }

  async loadDocument(docId) {
    const doc = DOCUMENTS.find(d => d.id === docId);
    if (!doc) return;

    // Update active nav item
    this.elements.navList.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.doc === docId);
    });

    // Update title
    this.elements.docTitle.textContent = doc.title;

    // Show loading state
    this.elements.docContent.innerHTML = '<div class="loading"></div>';

    try {
      const content = this.documents.get(docId) || (await this.fetchDocument(doc.file));
      const htmlContent = marked(content);

      this.elements.docContent.innerHTML = htmlContent;
      this.currentDoc = docId;

      // Add copy buttons to code blocks
      this.addCopyButtons();

      // Scroll to top
      this.elements.content.scrollTop = 0;
    } catch (error) {
      this.elements.docContent.innerHTML = `
        <div class="error-message">
          <p>Failed to load document: ${error.message}</p>
        </div>
      `;
    }
  }

  async fetchDocument(filename) {
    const response = await fetch(`/docs/${filename}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
  }

  addCopyButtons() {
    const codeBlocks = this.elements.docContent.querySelectorAll('pre code');

    codeBlocks.forEach(block => {
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-button';
      copyButton.textContent = 'Copy';

      copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(block.textContent);
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      });

      block.parentElement.insertBefore(copyButton, block);
    });
  }

  handleSearch(query) {
    if (!query.trim()) {
      this.renderNavigation();
      return;
    }

    const searchTerm = query.toLowerCase();
    const results = [];

    // Search through all documents
    for (const [docId, chunks] of this.searchIndex) {
      const matches = chunks.filter(chunk => chunk.text.includes(searchTerm));

      if (matches.length > 0) {
        const doc = DOCUMENTS.find(d => d.id === docId);
        results.push({
          doc,
          matches: matches.slice(0, 3), // Limit to 3 matches per doc
        });
      }
    }

    // Render search results
    this.renderSearchResults(results, searchTerm);
  }

  renderSearchResults(results, searchTerm) {
    if (results.length === 0) {
      this.elements.navList.innerHTML = `
        <li class="nav-item">
          <div class="no-results">No results found for "${searchTerm}"</div>
        </li>
      `;
      return;
    }

    this.elements.navList.innerHTML = results
      .map(
        result => `
      <li class="nav-item">
        <a href="#${result.doc.id}" class="nav-link search-result" data-doc="${result.doc.id}">
          <div class="nav-link-title">${result.doc.title}</div>
          <div class="search-matches">
            ${result.matches
              .map(
                match =>
                  `<div class="match-line">${this.highlightMatch(match.original, searchTerm)}</div>`
              )
              .join('')}
          </div>
        </a>
      </li>
    `
      )
      .join('');

    // Re-bind click handlers
    this.elements.navList.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const docId = link.dataset.doc;
        this.loadDocument(docId);
        window.location.hash = docId;

        // Clear search and restore navigation
        this.elements.searchInput.value = '';
        this.renderNavigation();
      });
    });
  }

  highlightMatch(text, searchTerm) {
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
  }
}

// Initialize the viewer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new DocumentationViewer();
});
