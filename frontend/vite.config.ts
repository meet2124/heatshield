import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// VITE_API_BASE_URL is injected at build time from frontend/.env or
// frontend/.env.production.  Never put ORS_API_KEY or any server secret here.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
