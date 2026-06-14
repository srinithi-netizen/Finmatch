import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/

export default defineConfig({
  optimizeDeps: {
    exclude: ["pdf-parse"],
  },
  // if it's a server-side only module, also add:
  ssr: {
    noExternal: ["pdf-parse"],
  },
});