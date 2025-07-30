import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MarkdownDocsViewer',
      formats: ['es', 'umd'],
      fileName: format => `index.${format}.js`,
    },
    rollupOptions: {
      external: ['marked', 'marked-highlight', 'highlight.js'],
      output: {
        globals: {
          marked: 'marked',
          'marked-highlight': 'markedHighlight',
          'highlight.js': 'hljs',
        },
      },
    },
    sourcemap: true,
    minify: true,
  },
  server: {
    port: 5000,
  },
});
