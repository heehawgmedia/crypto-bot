import { defineConfig } from 'vite';

// When deployed to GitHub Pages the site lives under /<repo-name>/.
export default defineConfig({
  // Relative asset paths so the build also works from any sub-folder or static host.
  base: process.env.GITHUB_PAGES ? '/barndo-planner/' : './',
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
