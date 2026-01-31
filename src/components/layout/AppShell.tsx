import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-warm">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">{children}</div>
    </div>
  );
}
