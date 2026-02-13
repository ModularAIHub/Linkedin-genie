import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-monitoring': ['@honeybadger-io/react', '@honeybadger-io/js'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['@headlessui/react', 'lucide-react', 'react-hot-toast']
        }
      }
    }
  },
  server: {
    port: 5175,
    open: true,
  },
  preview: {
    port: 5175,
  },
});
