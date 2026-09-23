import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // 127.0.0.1 y no localhost: Flask escucha solo en IPv4, y Node puede
        // resolver localhost a ::1 y no encontrarlo.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Con el backend apagado, el proxy respondía un 500 vacío y la app solo
        // decía «error de conexión». Así se sabe qué falta.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!('writeHead' in res) || res.headersSent) return
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              error: 'El backend no responde en http://127.0.0.1:8000. Arráncalo con: cd backend && python app.py',
            }))
          })
        },
      }
    }
  }
})
