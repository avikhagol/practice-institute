import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/admin/', plugins: [react(), {name:'admin-csp', transformIndexHtml:()=>[{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'"},injectTo:'head-prepend'}]}],
  build: {outDir:'dist-admin', target:'es2022', rollupOptions:{input:'admin/index.html'}, chunkSizeWarningLimit:1500},
});
