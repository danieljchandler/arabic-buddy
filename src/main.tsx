import { createRoot } from "react-dom/client";
import "./index.css";
import "./lib/storageBootstrap";

// Boot diagnostics
console.log("[boot] main.tsx executing", Date.now());
console.log("[boot] SUPABASE_URL:", !!import.meta.env.VITE_SUPABASE_URL);
console.log("[boot] SUPABASE_KEY:", !!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

const root = document.getElementById("root");
console.log("[boot] #root element:", !!root);

const boot = async () => {
  try {
    const { default: App } = await import("./App.tsx");
    createRoot(root!).render(<App />);
    console.log("[boot] render() called successfully");
  } catch (err) {
    console.error("[boot] FATAL render error:", err);
    if (root) {
      root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;flex-direction:column;gap:12px"><p style="font-size:18px;color:#8C4135">⚠️ App failed to load</p><pre style="font-size:12px;color:#666;max-width:90vw;overflow:auto">${String(err)}</pre><button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;background:#8C4135;color:white;border:none;cursor:pointer">Reload</button></div>`;
    }
  }
};

void boot();
