import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/ — cache bust v4
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      protocol: "wss",
      clientPort: 443,
      overlay: false,
    },
    headers: {
      "Permissions-Policy": "microphone=*",
    },
  },
  define: {
    // Supabase env vars MUST be set at build time via environment variables.
    // Do NOT add hardcoded fallback values here — they would be committed to
    // source control and embedded in the production bundle.
    ...(process.env.VITE_SUPABASE_URL
      ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL) }
      : {}),
    ...(process.env.VITE_SUPABASE_PUBLISHABLE_KEY
      ? { 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(process.env.VITE_SUPABASE_PUBLISHABLE_KEY) }
      : {}),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
