#!/usr/bin/env node

/**
 * OpenAPI Documentation Generator
 *
 * Generates HTML documentation from OpenAPI specification and
 * validates the API specification for completeness and correctness.
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class OpenAPIDocGenerator {
  constructor(options = {}) {
    this.options = {
      specPath: options.specPath || './docs/api/openapi.yaml',
      outputDir: options.outputDir || './docs/api/generated',
      templateDir: options.templateDir || './docs/api/templates',
      ...options,
    };
  }

  /**
   * Initialize the documentation generator
   */
  async initialize() {
    await this.ensureOutputDir();
    console.log('📚 OpenAPI Documentation Generator initialized');
  }

  /**
   * Ensure output directory exists
   */
  async ensureOutputDir() {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create output directory:', error);
      throw error;
    }
  }

  /**
   * Load and parse OpenAPI specification
   */
  async loadOpenAPISpec() {
    try {
      const specContent = await fs.readFile(this.options.specPath, 'utf8');
      const spec = yaml.load(specContent);
      console.log('📄 OpenAPI specification loaded successfully');
      return spec;
    } catch (error) {
      console.error('Failed to load OpenAPI specification:', error);
      throw error;
    }
  }

  /**
   * Validate OpenAPI specification
   */
  validateSpec(spec) {
    const errors = [];
    const warnings = [];

    // Check required fields
    if (!spec.openapi) errors.push('Missing openapi version');
    if (!spec.info) errors.push('Missing info section');
    if (!spec.paths) errors.push('Missing paths section');

    // Check info completeness
    if (spec.info) {
      if (!spec.info.title) errors.push('Missing API title');
      if (!spec.info.version) errors.push('Missing API version');
      if (!spec.info.description) warnings.push('Missing API description');
    }

    // Check paths
    if (spec.paths) {
      const pathCount = Object.keys(spec.paths).length;
      if (pathCount === 0) warnings.push('No API paths defined');
      console.log(`📊 Found ${pathCount} API paths`);

      // Check for missing operation IDs
      let operationCount = 0;
      for (const [pathName, pathItem] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
            operationCount++;
            if (!operation.operationId) {
              warnings.push(`Missing operationId for ${method.toUpperCase()} ${pathName}`);
            }
            if (!operation.summary) {
              warnings.push(`Missing summary for ${method.toUpperCase()} ${pathName}`);
            }
            if (!operation.responses) {
              errors.push(`Missing responses for ${method.toUpperCase()} ${pathName}`);
            }
          }
        }
      }
      console.log(`📊 Found ${operationCount} API operations`);
    }

    // Check components
    if (spec.components) {
      const schemaCount = spec.components.schemas ? Object.keys(spec.components.schemas).length : 0;
      console.log(`📊 Found ${schemaCount} schema definitions`);
    }

    // Report validation results
    if (errors.length > 0) {
      console.log('\n❌ Validation Errors:');
      errors.forEach(error => console.log(`  - ${error}`));
    }

    if (warnings.length > 0) {
      console.log('\n⚠️ Validation Warnings:');
      warnings.forEach(warning => console.log(`  - ${warning}`));
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ OpenAPI specification is valid');
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  /**
   * Generate HTML documentation
   */
  async generateHTMLDocs(spec) {
    const html = this.generateSwaggerUI(spec);
    const outputPath = path.join(this.options.outputDir, 'index.html');
    await fs.writeFile(outputPath, html);
    console.log(`📖 HTML documentation generated: ${outputPath}`);
  }

  /**
   * Generate Swagger UI HTML
   */
  generateSwaggerUI(spec) {
    const specJson = JSON.stringify(spec, null, 2);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${spec.info?.title || 'API'} Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
    }
    .swagger-ui .topbar {
      background-color: #2c3e50;
    }
    .swagger-ui .topbar .download-url-wrapper {
      display: none;
    }
    .custom-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
      margin-bottom: 20px;
    }
    .custom-header h1 {
      margin: 0;
      font-size: 2.5em;
      font-weight: 300;
    }
    .custom-header p {
      margin: 10px 0 0 0;
      font-size: 1.2em;
      opacity: 0.9;
    }
    .custom-info {
      background: white;
      padding: 20px;
      margin: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
    }
    .info-item {
      text-align: center;
    }
    .info-item h3 {
      margin: 0 0 10px 0;
      color: #2c3e50;
    }
    .info-item p {
      margin: 0;
      color: #7f8c8d;
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <h1>${spec.info?.title || 'API Documentation'}</h1>
    <p>${spec.info?.description?.split('\\n')[0] || 'Interactive API Documentation'}</p>
  </div>
  
  <div class="custom-info">
    <div class="info-grid">
      <div class="info-item">
        <h3>Version</h3>
        <p>${spec.info?.version || 'Unknown'}</p>
      </div>
      <div class="info-item">
        <h3>Base URL</h3>
        <p>${spec.servers?.[0]?.url || 'Not specified'}</p>
      </div>
      <div class="info-item">
        <h3>Endpoints</h3>
        <p>${Object.keys(spec.paths || {}).length} paths</p>
      </div>
      <div class="info-item">
        <h3>Schemas</h3>
        <p>${Object.keys(spec.components?.schemas || {}).length} models</p>
      </div>
    </div>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        spec: ${specJson},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;
  }

  /**
   * Generate Redoc documentation
   */
  async generateRedocDocs(spec) {
    const html = this.generateRedocHTML(spec);
    const outputPath = path.join(this.options.outputDir, 'redoc.html');
    await fs.writeFile(outputPath, html);
    console.log(`📖 Redoc documentation generated: ${outputPath}`);
  }

  /**
   * Generate Redoc HTML
   */
  generateRedocHTML(spec) {
    const specJson = JSON.stringify(spec, null, 2);

    return `<!DOCTYPE html>
<html>
<head>
  <title>${spec.info?.title || 'API'} Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <redoc spec-url="data:application/json;base64,${Buffer.from(specJson).toString('base64')}" theme="typography: { fontSize: '14px' }"></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.js"></script>
</body>
</html>`;
  }

  /**
   * Generate Postman collection
   */
  async generatePostmanCollection(spec) {
    const collection = this.convertToPostmanCollection(spec);
    const outputPath = path.join(this.options.outputDir, 'postman-collection.json');
    await fs.writeFile(outputPath, JSON.stringify(collection, null, 2));
    console.log(`📮 Postman collection generated: ${outputPath}`);
  }

  /**
   * Convert OpenAPI spec to Postman collection
   */
  convertToPostmanCollection(spec) {
    const collection = {
      info: {
        name: spec.info?.title || 'API Collection',
        description: spec.info?.description || '',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      auth: {
        type: 'bearer',
        bearer: [
          {
            key: 'token',
            value: '{{access_token}}',
            type: 'string',
          },
        ],
      },
      variable: [
        {
          key: 'base_url',
          value: spec.servers?.[0]?.url || 'http://localhost:3001/api',
          type: 'string',
        },
        {
          key: 'access_token',
          value: '',
          type: 'string',
        },
      ],
      item: [],
    };

    // Group endpoints by tags
    const groupedEndpoints = {};

    for (const [pathName, pathItem] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
          const tag = operation.tags?.[0] || 'Default';

          if (!groupedEndpoints[tag]) {
            groupedEndpoints[tag] = [];
          }

          const request = {
            name: operation.summary || `${method.toUpperCase()} ${pathName}`,
            request: {
              method: method.toUpperCase(),
              header: [
                {
                  key: 'Content-Type',
                  value: 'application/json',
                },
              ],
              url: {
                raw: '{{base_url}}' + pathName,
                host: ['{{base_url}}'],
                path: pathName.split('/').filter(p => p),
              },
            },
          };

          // Add auth if required
          if (operation.security || spec.security) {
            request.request.auth = {
              type: 'bearer',
              bearer: [
                {
                  key: 'token',
                  value: '{{access_token}}',
                  type: 'string',
                },
              ],
            };
          }

          // Add request body if applicable
          if (['post', 'put', 'patch'].includes(method.toLowerCase()) && operation.requestBody) {
            const schema = operation.requestBody.content?.['application/json']?.schema;
            if (schema) {
              request.request.body = {
                mode: 'raw',
                raw: JSON.stringify(this.generateExampleFromSchema(schema), null, 2),
                options: {
                  raw: {
                    language: 'json',
                  },
                },
              };
            }
          }

          groupedEndpoints[tag].push(request);
        }
      }
    }

    // Add grouped endpoints to collection
    for (const [tag, endpoints] of Object.entries(groupedEndpoints)) {
      collection.item.push({
        name: tag,
        item: endpoints,
      });
    }

    return collection;
  }

  /**
   * Generate example data from schema
   */
  generateExampleFromSchema(schema) {
    if (schema.example) {
      return schema.example;
    }

    if (schema.type === 'object') {
      const example = {};
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          example[propName] = this.generateExampleFromSchema(propSchema);
        }
      }
      return example;
    }

    if (schema.type === 'array') {
      return [this.generateExampleFromSchema(schema.items || {})];
    }

    switch (schema.type) {
      case 'string':
        if (schema.format === 'email') return 'user@example.com';
        if (schema.format === 'date-time') return new Date().toISOString();
        if (schema.format === 'date') return new Date().toISOString().split('T')[0];
        return schema.enum ? schema.enum[0] : 'string';
      case 'number':
      case 'integer':
        return schema.minimum || 0;
      case 'boolean':
        return true;
      default:
        return null;
    }
  }

  /**
   * Generate comprehensive documentation summary
   */
  async generateSummary(spec, validation) {
    const summary = {
      api: {
        title: spec.info?.title || 'Unknown',
        version: spec.info?.version || 'Unknown',
        description: spec.info?.description || 'No description',
        servers: spec.servers?.length || 0,
      },
      endpoints: {
        paths: Object.keys(spec.paths || {}).length,
        operations: 0,
        byMethod: {},
        byTag: {},
      },
      schemas: {
        total: Object.keys(spec.components?.schemas || {}).length,
        components: Object.keys(spec.components || {}).length,
      },
      validation: {
        errors: validation.errors.length,
        warnings: validation.warnings.length,
        isValid: validation.isValid,
      },
      generated: new Date().toISOString(),
    };

    // Count operations
    for (const pathItem of Object.values(spec.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
          summary.endpoints.operations++;

          const methodUpper = method.toUpperCase();
          summary.endpoints.byMethod[methodUpper] =
            (summary.endpoints.byMethod[methodUpper] || 0) + 1;

          const tag = operation.tags?.[0] || 'Untagged';
          summary.endpoints.byTag[tag] = (summary.endpoints.byTag[tag] || 0) + 1;
        }
      }
    }

    const summaryPath = path.join(this.options.outputDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`📊 Documentation summary generated: ${summaryPath}`);

    return summary;
  }

  /**
   * Generate all documentation formats
   */
  async generateAll() {
    console.log('🚀 Starting OpenAPI documentation generation...\n');

    // Load and validate specification
    const spec = await this.loadOpenAPISpec();
    const validation = this.validateSpec(spec);

    if (!validation.isValid) {
      console.error(
        '\n❌ OpenAPI specification has errors. Please fix them before generating documentation.'
      );
      process.exit(1);
    }

    // Generate all documentation formats
    await Promise.all([
      this.generateHTMLDocs(spec),
      this.generateRedocDocs(spec),
      this.generatePostmanCollection(spec),
    ]);

    // Generate summary
    const summary = await this.generateSummary(spec, validation);

    console.log('\n✅ Documentation generation complete!');
    console.log(`📊 Generated documentation for ${summary.endpoints.operations} API operations`);
    console.log(`📁 Output directory: ${this.options.outputDir}`);
    console.log('\n📖 Available formats:');
    console.log('  - Swagger UI: index.html');
    console.log('  - Redoc: redoc.html');
    console.log('  - Postman Collection: postman-collection.json');
    console.log('  - Summary: summary.json');
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'generate';

  const generator = new OpenAPIDocGenerator({
    specPath: process.env.OPENAPI_SPEC_PATH || './docs/api/openapi.yaml',
    outputDir: process.env.OPENAPI_OUTPUT_DIR || './docs/api/generated',
  });

  try {
    await generator.initialize();

    switch (command) {
      case 'generate':
      case 'all':
        await generator.generateAll();
        break;

      case 'validate':
        const spec = await generator.loadOpenAPISpec();
        const validation = generator.validateSpec(spec);
        if (validation.isValid) {
          console.log('✅ OpenAPI specification is valid');
          process.exit(0);
        } else {
          console.log('❌ OpenAPI specification has errors');
          process.exit(1);
        }
        break;

      case 'html':
        const htmlSpec = await generator.loadOpenAPISpec();
        await generator.generateHTMLDocs(htmlSpec);
        break;

      case 'postman':
        const postmanSpec = await generator.loadOpenAPISpec();
        await generator.generatePostmanCollection(postmanSpec);
        break;

      default:
        console.log('Usage: node generate-openapi-docs.js [generate|validate|html|postman]');
        console.log('  generate - Generate all documentation formats (default)');
        console.log('  validate - Validate OpenAPI specification only');
        console.log('  html     - Generate HTML documentation only');
        console.log('  postman  - Generate Postman collection only');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Documentation generation failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = OpenAPIDocGenerator;

// Run CLI if called directly
if (require.main === module) {
  main();
}
