import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], build: { rollupOptions: { input: { main: 'index.html', imageViewer: 'image-viewer.html' } } }, server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/.local/**', '**/.pnpm-store/**', '**/release/**'] } } });
