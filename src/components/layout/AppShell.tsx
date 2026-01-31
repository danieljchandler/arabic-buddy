import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-warm">
      <div className="min-h-screen bg-noise">
        <div className="mx-auto w-full max-w-5xl px-4 py-8">
          <div className="rounded-3xl bg-card/90 shadow-card border border-border/60 backdrop-blur">
            <div className="p-6 sm:p-8">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
