# Training Science Documentation Viewer

A modern, standalone web application for viewing and navigating the scientific documentation for the advanced training plan system.

## Features

- **Modern Dark Theme UI**: Clean, professional interface optimized for reading
- **Live Search**: Search across all documentation instantly
- **Syntax Highlighting**: Beautiful code examples with copy buttons
- **Responsive Design**: Works perfectly on desktop and mobile devices
- **Fast Navigation**: Quick access to all documents with descriptions

## Documents Included

1. **Training System Whitepaper**: Comprehensive overview of the science-based training system
2. **Scientific References**: Primary sources and research papers
3. **Implementation Guide**: Code-to-science mapping and technical details
4. **Calculations Reference**: Quick reference for all formulas and algorithms
5. **Complete Bibliography**: Full list of 40+ sources and citations

## Installation

```bash
cd docs-viewer
npm install
```

## Development

```bash
npm run dev
```

This will start the Vite development server at http://localhost:4000

## Build

```bash
npm run build
```

This creates a production build in the `dist` folder.

## Preview Production Build

```bash
npm run preview
```

## Technology Stack

- **Vite**: Fast build tool and dev server
- **Marked**: Markdown parsing
- **Highlight.js**: Syntax highlighting
- **Vanilla JavaScript**: No framework dependencies for maximum performance

## Project Structure

```
docs-viewer/
├── index.html          # Main HTML file
├── src/
│   └── main.js        # Application logic
├── styles/
│   └── main.css       # All styles
├── public/
│   └── docs/          # Symlink to documentation files
└── vite.config.js     # Vite configuration
```

## Features in Detail

### Search Functionality

- Real-time search across all documents
- Highlights matching text
- Shows context around matches
- Preserves navigation state

### Navigation

- Sidebar with all documents listed
- Active document highlighting
- Mobile-responsive hamburger menu
- URL hash-based routing

### Code Examples

- Syntax highlighting for multiple languages
- Copy button on all code blocks
- Proper formatting and indentation
- Dark theme optimized colors

### Responsive Design

- Desktop: Full sidebar + content view
- Mobile: Collapsible sidebar with overlay
- Touch-friendly interface elements
- Optimized font sizes for all screens
