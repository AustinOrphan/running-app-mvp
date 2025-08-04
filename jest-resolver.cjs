const path = require('path');
const fs = require('fs');

module.exports = (request, options) => {
  // Enhanced ES module resolution for TypeScript files with .js extensions
  if (request.endsWith('.js')) {
    const basePath = path.dirname(options.basedir || '');
    const relativePath = path.isAbsolute(request) ? request : path.resolve(basePath, request);
    const tsRequest = request.replace(/\.js$/, '.ts');

    // Check multiple resolution strategies
    const resolutionStrategies = [
      // Strategy 1: Try .ts file directly
      () => options.defaultResolver(tsRequest, options),

      // Strategy 2: Try .js file if it exists
      () => {
        const jsPath = relativePath;
        if (fs.existsSync(jsPath)) {
          return options.defaultResolver(request, options);
        }
        throw new Error('JS file not found');
      },

      // Strategy 3: Try original request as fallback
      () => options.defaultResolver(request, options),
    ];

    for (const strategy of resolutionStrategies) {
      try {
        return strategy();
      } catch (e) {
        // Continue to next strategy
        continue;
      }
    }

    // If all strategies fail, provide helpful error message
    throw new Error(`Unable to resolve module '${request}'. Tried .ts and .js variants.`);
  }

  // Handle other cases with enhanced error reporting
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    // Provide more context for debugging
    if (request.includes('transactionIsolation') || request.includes('testSetup')) {
      console.warn(
        `Jest resolver: Failed to resolve test utility '${request}'. This might be expected if the file doesn't exist.`
      );
    }
    throw error;
  }
};
