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
    // Ensure Supabase env vars are always available at build time
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || "https://ovscskaijvclaxelkdyf.supabase.co"),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92c2Nza2FpanZjbGF4ZWxrZHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjM5NzAsImV4cCI6MjA4NDY5OTk3MH0.8fH3gVx8ft5KvHbeD0ngNs1-ZClg2R7a_juQ0_dwMW0"),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
