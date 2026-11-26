import { defineConfig } from 'vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [wgslVitePlugin()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
