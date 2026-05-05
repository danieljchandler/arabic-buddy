import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PictureSceneHotspot } from "@/hooks/usePictureScenes";

export type SceneMode = "explore" | "quiz" | "edit";

interface SceneCanvasProps {
  imageUrl: string | null;
  hotspots: PictureSceneHotspot[];
  mode: SceneMode;
  /** quiz target id; the user must tap this hotspot. */
  targetId?: string | null;
  /** explore: which hotspot the user clicked (highlighted). */
  selectedId?: string | null;
  /** explore/quiz tap handler. Receives hotspot. */
  onHotspotTap?: (hs: PictureSceneHotspot) => void;
  /** quiz miss handler — user tapped outside any hotspot or wrong one. */
  onMiss?: () => void;
  /** edit-only: drag hotspot to (x,y) percent. */
  onMove?: (id: string, xPct: number, yPct: number) => void;
  /** edit-only: place a hotspot that has no coords yet by clicking. */
  onPlace?: (id: string, xPct: number, yPct: number) => void;
  /** edit-only: which hotspot is selected for placement. */
  pendingPlacementId?: string | null;
  /** show all hotspot dots (explore + edit) or hide them (quiz). */
  showHotspots?: boolean;
  className?: string;
}

/**
 * Renders the scene image with an overlay layer of clickable hotspot circles.
 * Coordinates are stored in percentages so the canvas stays responsive.
 */
export const SceneCanvas = ({
  imageUrl,
  hotspots,
  mode,
  targetId,
  selectedId,
  onHotspotTap,
  onMiss,
  onMove,
  onPlace,
  pendingPlacementId,
  showHotspots = true,
  className,
}: SceneCanvasProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [imageBox, setImageBox] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateImageBox = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !imageAspect) {
      setImageBox({ left: 0, top: 0, width: 100, height: 100 });
      return;
    }

    const containerAspect = rect.width / rect.height;
    if (containerAspect > imageAspect) {
      const widthPct = (imageAspect / containerAspect) * 100;
      setImageBox({ left: (100 - widthPct) / 2, top: 0, width: widthPct, height: 100 });
    } else {
      const heightPct = (containerAspect / imageAspect) * 100;
      setImageBox({ left: 0, top: (100 - heightPct) / 2, width: 100, height: heightPct });
    }
  }, [imageAspect]);

  useEffect(() => {
    updateImageBox();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(updateImageBox);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [updateImageBox]);

  const getPct = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const imgLeft = rect.left + (imageBox.left / 100) * rect.width;
    const imgTop = rect.top + (imageBox.top / 100) * rect.height;
    const imgWidth = (imageBox.width / 100) * rect.width;
    const imgHeight = (imageBox.height / 100) * rect.height;
    const x = ((e.clientX - imgLeft) / imgWidth) * 100;
    const y = ((e.clientY - imgTop) / imgHeight) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (mode === "edit" && pendingPlacementId && onPlace) {
      const p = getPct(e);
      if (!p) return;
      onPlace(pendingPlacementId, p.x, p.y);
      return;
    }
    if (mode === "quiz" && onMiss) {
      // Only trigger miss if click wasn't on a hotspot button (handled there with stopPropagation)
      onMiss();
    }
  };

  return (
    <div
      ref={wrapRef}
      onClick={handleCanvasClick}
      onMouseMove={(e) => {
        if (mode !== "edit" || !draggingId || !onMove) return;
        const p = getPct(e);
        if (p) onMove(draggingId, p.x, p.y);
      }}
      onMouseUp={() => setDraggingId(null)}
      onMouseLeave={() => setDraggingId(null)}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border-2 border-primary/20 bg-muted",
        "aspect-[4/3] select-none",
        mode === "edit" && pendingPlacementId && "cursor-crosshair",
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="Scene"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setImageAspect(img.naturalWidth / img.naturalHeight);
            }
          }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
          No image yet
        </div>
      )}

      {hotspots.map((hs) => {
          if (hs.x_pct == null || hs.y_pct == null) return null;
          const isTarget = targetId === hs.id;
          const isSelected = selectedId === hs.id;
          // In quiz mode keep the buttons clickable but visually hidden.
          const visibleInQuiz = mode !== "quiz" && showHotspots;
          const radius = hs.radius_pct ?? 8;
          return (
            <button
              key={hs.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (mode === "edit") {
                  setDraggingId(hs.id);
                  return;
                }
                onHotspotTap?.(hs);
              }}
              onMouseDown={(e) => {
                if (mode === "edit") {
                  e.stopPropagation();
                  setDraggingId(hs.id);
                }
              }}
              style={{
                left: `${imageBox.left + (hs.x_pct / 100) * imageBox.width}%`,
                top: `${imageBox.top + (hs.y_pct / 100) * imageBox.height}%`,
                width: `${(radius * 2 * imageBox.width) / 100}%`,
                paddingTop: `${(radius * 2 * imageBox.width) / 100}%`,
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all",
                visibleInQuiz
                  ? cn(
                      "border-2 border-white/80 bg-primary/30 hover:bg-primary/50 shadow-lg",
                      isSelected && "ring-4 ring-primary bg-primary/60",
                      isTarget && mode === "edit" && "ring-4 ring-amber-400",
                    )
                  : "bg-transparent border-0 hover:bg-primary/10",
                mode === "edit" && "cursor-move",
              )}
              aria-label={hs.word_english || hs.word_arabic}
            />
          );
        })}
    </div>
  );
};
