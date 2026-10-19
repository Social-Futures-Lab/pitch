import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    {
      name: "tutorial-rewrite",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/tutorial") {
            req.url = "/tutorial.html";
          }
          next();
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", "groupchat.ngrok.app"],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});
