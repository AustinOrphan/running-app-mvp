import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

export default (request, options) => {
  // If the request ends with .js, try to resolve it as .ts first
  if (request.endsWith('.js')) {
    const tsRequest = request.replace(/\.js$/, '.ts');
    
    // Try to resolve the .ts version
    try {
      const tsPath = path.resolve(options.basedir, tsRequest);
      if (fs.existsSync(tsPath)) {
        return options.defaultResolver(tsRequest, options);
      }
    } catch (e) {
      // If .ts doesn't exist, fallback to default resolution
    }
  }
  
  // Use default resolver for all other cases
  return options.defaultResolver(request, options);
};