import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Environment check
console.log("[env-check] SUPABASE_URL loaded:", !!import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_URL?.substring(0, 30));

createRoot(document.getElementById("root")!).render(<App />);
