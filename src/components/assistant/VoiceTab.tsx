import { Mic } from "lucide-react";

/** Placeholder — the live voice assistant lands in the next phase. */
export function VoiceTab() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Mic className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Live voice is coming soon.</p>
    </div>
  );
}
