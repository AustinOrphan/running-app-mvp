// Entry point for npm package
// This allows the documentation to be imported programmatically

const fs = require('fs');
const path = require('path');

const documents = {
  whitepaper: 'training-system-whitepaper.md',
  references: 'training-science-references.md',
  implementation: 'training-implementation-guide.md',
  calculations: 'training-calculations-reference.md',
  bibliography: 'training-bibliography.md',
};

/**
 * Get the content of a specific document
 * @param {string} docName - Name of the document (whitepaper, references, etc.)
 * @returns {string} The markdown content
 */
function getDocument(docName) {
  if (!documents[docName]) {
    throw new Error(
      `Document '${docName}' not found. Available: ${Object.keys(documents).join(', ')}`
    );
  }

  const filePath = path.join(__dirname, documents[docName]);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Get all documents as an object
 * @returns {Object} Object with document names as keys and content as values
 */
function getAllDocuments() {
  const result = {};

  for (const [name, file] of Object.entries(documents)) {
    const filePath = path.join(__dirname, file);
    result[name] = fs.readFileSync(filePath, 'utf8');
  }

  return result;
}

/**
 * Get metadata about available documents
 * @returns {Array} Array of document metadata
 */
function getDocumentList() {
  return [
    {
      id: 'whitepaper',
      title: 'Training System Whitepaper',
      file: documents.whitepaper,
      description: 'Comprehensive overview of the science-based training system',
    },
    {
      id: 'references',
      title: 'Scientific References',
      file: documents.references,
      description: 'Primary sources and research papers',
    },
    {
      id: 'implementation',
      title: 'Implementation Guide',
      file: documents.implementation,
      description: 'Code-to-science mapping and technical details',
    },
    {
      id: 'calculations',
      title: 'Calculations Reference',
      file: documents.calculations,
      description: 'Quick reference for all formulas and algorithms',
    },
    {
      id: 'bibliography',
      title: 'Complete Bibliography',
      file: documents.bibliography,
      description: 'Full list of 40+ sources and citations',
    },
  ];
}

module.exports = {
  getDocument,
  getAllDocuments,
  getDocumentList,
  documents,
};
