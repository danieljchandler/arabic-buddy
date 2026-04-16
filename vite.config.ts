import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const supabaseProjectId =
  process.env.VITE_SUPABASE_PROJECT_ID ?? process.env.SUPABASE_PROJECT_ID;

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  (supabaseProjectId ? `https://${supabaseProjectId}.supabase.co` : undefined);

const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY;

// https://vitejs.dev/config/ — cache bust v4
export default defineConfig(({ mode }) => ({
  // Lovable Cloud can rewrite the root .env after backend changes, which makes
  // Vite restart the preview server. Keep Vite env discovery on an isolated
  // directory and inject the required client vars from process.env instead.
  envDir: ".vite-env",
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
    // Backend env vars MUST be available at build time. Accept both the
    // Vite-prefixed names and Lovable Cloud's standard secret names.
    ...(supabaseProjectId
      ? { 'import.meta.env.VITE_SUPABASE_PROJECT_ID': JSON.stringify(supabaseProjectId) }
      : {}),
    ...(supabaseUrl
      ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl) }
      : {}),
    ...(supabasePublishableKey
      ? { 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabasePublishableKey) }
      : {}),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
