import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs, because the app is served from a repository subpath
  // (https://orenaim.github.io/gdrive-md/) rather than a domain root. With the
  // default base of '/', every asset would be requested from
  // https://orenaim.github.io/assets/… and 404.
  //
  // Relative rather than a hardcoded '/gdrive-md/' so the same build works
  // unchanged at a domain root, under a different repository name, or on the
  // dev server — there is no client-side routing to complicate it.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
