const path = require('path');
const fs = require('fs');

module.exports = (request, options) => {
  // Only try to resolve .js requests that might be .ts files
  if (request.endsWith('.js')) {
    const tsRequest = request.replace(/\.js$/, '.ts');

    try {
      // Try to resolve the .ts version first
      const resolved = options.defaultResolver(tsRequest, options);
      return resolved;
    } catch (e) {
      // If .ts resolution fails, fall back to .js
      try {
        return options.defaultResolver(request, options);
      } catch (originalError) {
        // If both fail, throw the original error
        throw originalError;
      }
    }
  }

  // Use default resolver for all other cases
  return options.defaultResolver(request, options);
};
