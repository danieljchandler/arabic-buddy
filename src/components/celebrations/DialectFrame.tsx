import type { DialectModule } from "@/contexts/DialectContext";
import { MashrabiyaFrame } from "./MashrabiyaFrame";
import { NajdiFrame } from "./NajdiFrame";
import { QamariyaFrame } from "./QamariyaFrame";

/**
 * The dance's name in a frame drawn from its dialect's own architecture:
 * Najdi mud brick for the Gulf, a Cairo mashrabiya for Egyptian, a Sana'a
 * qamariya window for Yemeni.
 */
const FRAMES: Record<DialectModule, typeof NajdiFrame> = {
  Gulf: NajdiFrame,
  Egyptian: MashrabiyaFrame,
  Yemeni: QamariyaFrame,
};

export function DialectFrame({ dialect, title, className }: { dialect: DialectModule; title: string; className?: string }) {
  const Frame = FRAMES[dialect];
  return <Frame title={title} className={className} />;
}
