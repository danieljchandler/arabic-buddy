import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-warm">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        {/* soft surface, not a giant box */}
        <div className="rounded-3xl bg-card shadow-card border border-border/40">
          <div className="p-6 sm:p-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
