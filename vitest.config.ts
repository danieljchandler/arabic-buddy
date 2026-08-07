import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // src/integrations/supabase/client.ts throws at import time when these are
    // missing, which is why hook tests have historically had to vi.mock the
    // client just to be importable. Setting them here lets tests exercise the
    // real supabase-js query builder against the in-memory backend instead.
    //
    // The host is deliberately the same fake as playwright.config.ts, and the
    // values are deliberately NOT vite.config.ts's fallbacks: that file falls
    // back to the real production project ref and a real anon key, so mirroring
    // its logic here would point the unit suite at production. Never do that —
    // src/test/envGuard.test.ts fails the build if these drift.
    env: {
      VITE_SUPABASE_URL: "https://e2e.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon-key-not-a-real-secret",
      VITE_SUPABASE_PROJECT_ID: "e2e",
      // Empty on purpose: usePushNotifications reports itself unsupported when
      // this is blank, which is the default branch most tests should see.
      VITE_VAPID_PUBLIC_KEY: "",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/vite-env.d.ts",
      ],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
