import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Loader2,
  Wand2,
  Volume2,
  Play,
  Save,
  Eye,
  RefreshCw,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SceneCanvas } from "@/components/picture-scenes/SceneCanvas";
import {
  useScene,
  useGenerateSceneImage,
  useGenerateSceneAudio,
  useUpdateHotspot,
  useDeleteHotspot,
  useAddHotspot,
  usePublishScene,
} from "@/hooks/usePictureScenes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const AdminPictureSceneEdit = () => {
  const { sceneId } = useParams<{ sceneId: string }>();
  const navigate = useNavigate();
  const { data: scene, isLoading, refetch } = useScene(sceneId);
  const genImage = useGenerateSceneImage();
  const genAudio = useGenerateSceneAudio();
  const updateHotspot = useUpdateHotspot();
  const deleteHotspot = useDeleteHotspot();
  const addHotspot = useAddHotspot();
  const publish = usePublishScene();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imgInstr, setImgInstr] = useState("");
  const [regenHotspots, setRegenHotspots] = useState(true);
  const [shiftStep, setShiftStep] = useState(3);
  const [nudgeStep, setNudgeStep] = useState(1);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!scene || !sceneId) {
    return <p className="text-center py-12 text-muted-foreground">Scene not found.</p>;
  }

  const handleMove = (id: string, x: number, y: number) => {
    // optimistic local update via mutation patch
    updateHotspot.mutate({
      id,
      sceneId,
      patch: { x_pct: Number(x.toFixed(2)), y_pct: Number(y.toFixed(2)) },
    });
  };

  const handlePlace = (id: string, x: number, y: number) => {
    updateHotspot.mutate({
      id,
      sceneId,
      patch: { x_pct: Number(x.toFixed(2)), y_pct: Number(y.toFixed(2)) },
    });
    setPendingId(null);
    setSelectedId(id);
  };

  const handleHotspotTap = (hs: { id: string }) => {
    if (pendingId) return;
    setSelectedId((prev) => (prev === hs.id ? null : hs.id));
  };

  const handleNudge = async (dx: number, dy: number) => {
    if (!selectedId) {
      toast.error("Select a hotspot first");
      return;
    }
    const hs = scene.hotspots.find((h) => h.id === selectedId);
    if (!hs || hs.x_pct == null || hs.y_pct == null) {
      toast.error("This hotspot has no position yet");
      return;
    }
    const nextX = Math.max(0, Math.min(100, Number(hs.x_pct) + dx));
    const nextY = Math.max(0, Math.min(100, Number(hs.y_pct) + dy));
    await updateHotspot.mutateAsync({
      id: hs.id,
      sceneId,
      patch: { x_pct: Number(nextX.toFixed(2)), y_pct: Number(nextY.toFixed(2)) },
    });
    refetch();
  };

  const handleResize = async (delta: number) => {
    if (!selectedId) {
      toast.error("Select a hotspot first");
      return;
    }
    const hs = scene.hotspots.find((h) => h.id === selectedId);
    if (!hs) return;
    const next = Math.max(2, Math.min(30, Number(hs.radius_pct ?? 8) + delta));
    await updateHotspot.mutateAsync({
      id: hs.id,
      sceneId,
      patch: { radius_pct: Number(next.toFixed(2)) },
    });
    refetch();
  };

  const handleShiftAll = async (dx: number, dy: number) => {
    const placedHotspots = scene.hotspots.filter((h) => h.x_pct != null && h.y_pct != null);
    if (placedHotspots.length === 0) {
      toast.error("No hotspots to shift");
      return;
    }

    try {
      await Promise.all(
        placedHotspots.map((h) => {
          const nextX = Math.max(0, Math.min(100, Number(h.x_pct) + dx));
          const nextY = Math.max(0, Math.min(100, Number(h.y_pct) + dy));
          return updateHotspot.mutateAsync({
            id: h.id,
            sceneId,
            patch: { x_pct: Number(nextX.toFixed(2)), y_pct: Number(nextY.toFixed(2)) },
          });
        }),
      );
      toast.success("Hotspots shifted");
      refetch();
    } catch (err) {
      toast.error("Could not shift hotspots", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handlePublish = () => {
    const missingCoords = scene.hotspots.filter((h) => h.x_pct == null || h.y_pct == null);
    if (missingCoords.length > 0) {
      toast.error("Place every hotspot first", {
        description: `${missingCoords.length} word${missingCoords.length === 1 ? " has" : "s have"} no position yet.`,
      });
      return;
    }
    const missingAudio = scene.hotspots.filter((h) => !h.word_audio_url);
    if (missingAudio.length > 0) {
      toast.warning("Some words have no audio", {
        description: "Generate audio first for the best learner experience.",
      });
    }
    publish.mutate(sceneId);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={() => navigate("/admin/picture-scenes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={scene.status === "published" ? "default" : "secondary"}>
            {scene.status}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/picture-scenes/${sceneId}`)}
          >
            <Eye className="h-4 w-4 mr-1" />
            Preview as learner
          </Button>
          <Button onClick={handlePublish} disabled={publish.isPending || scene.status === "published"}>
            <Save className="h-4 w-4 mr-2" />
            {scene.status === "published" ? "Published" : publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scene.title}</h1>
        <p className="text-muted-foreground" dir="rtl">{scene.title_arabic}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline">{scene.theme}</Badge>
          <Badge variant="outline">{scene.dialect}</Badge>
          {scene.cefr_level && <Badge variant="secondary">{scene.cefr_level}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <SceneCanvas
            imageUrl={scene.image_url}
            hotspots={scene.hotspots}
            mode="edit"
            onMove={handleMove}
            onPlace={handlePlace}
            onHotspotTap={handleHotspotTap}
            selectedId={selectedId}
            pendingPlacementId={pendingId}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {pendingId
              ? "Click on the image to place this word."
              : selectedId
                ? "Use the arrows below to nudge the selected hotspot, or resize it."
                : "Tap a numbered circle to select it, then use the arrows to nudge or resize."}
          </p>

          {selectedId && (() => {
            const hs = scene.hotspots.find((h) => h.id === selectedId);
            if (!hs) return null;
            const idx = scene.hotspots.findIndex((h) => h.id === selectedId);
            return (
              <Card className="mt-4 border-primary/40">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm font-medium">
                        Hotspot #{idx + 1} —{" "}
                        <span dir="rtl" className="font-semibold">{hs.word_arabic}</span>
                        <span className="text-muted-foreground ml-1">({hs.word_english})</span>
                      </Label>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Deselect</Button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs text-muted-foreground">Custom step (%)</Label>
                    <Input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.25}
                      value={nudgeStep}
                      onChange={(e) => setNudgeStep(Math.max(0.1, Math.min(50, Number(e.target.value) || 0.1)))}
                      className="h-8 w-20 text-sm"
                    />
                  </div>
                  <div className="flex items-start gap-4 justify-center flex-wrap">
                    {[
                      { step: 0.5, label: "Fine", icon: "h-3 w-3", btn: "h-7 w-7" },
                      { step: 2, label: "Med", icon: "h-4 w-4", btn: "h-9 w-9" },
                      { step: 8, label: "Big", icon: "h-5 w-5", btn: "h-11 w-11" },
                      { step: nudgeStep, label: `±${nudgeStep}`, icon: "h-4 w-4", btn: "h-9 w-9" },
                    ].map(({ step, label, icon, btn }) => (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <Label className="text-[10px] text-muted-foreground">{label}</Label>
                        <div className="grid grid-cols-3 gap-1">
                          <span />
                          <Button size="icon" variant="outline" className={btn} onClick={() => handleNudge(0, -step)} disabled={updateHotspot.isPending} aria-label={`Nudge up ${step}`}>
                            <ArrowUp className={icon} />
                          </Button>
                          <span />
                          <Button size="icon" variant="outline" className={btn} onClick={() => handleNudge(-step, 0)} disabled={updateHotspot.isPending} aria-label={`Nudge left ${step}`}>
                            <ArrowLeft className={icon} />
                          </Button>
                          <span />
                          <Button size="icon" variant="outline" className={btn} onClick={() => handleNudge(step, 0)} disabled={updateHotspot.isPending} aria-label={`Nudge right ${step}`}>
                            <ArrowRight className={icon} />
                          </Button>
                          <span />
                          <Button size="icon" variant="outline" className={btn} onClick={() => handleNudge(0, step)} disabled={updateHotspot.isPending} aria-label={`Nudge down ${step}`}>
                            <ArrowDown className={icon} />
                          </Button>
                          <span />
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-col items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Size</Label>
                      <Button size="icon" variant="outline" onClick={() => handleResize(1)} disabled={updateHotspot.isPending} aria-label="Grow hotspot">
                        <Plus className="h-4 w-4" />
                      </Button>
                      <div className="text-xs font-mono text-muted-foreground">{Number(hs.radius_pct ?? 8).toFixed(1)}</div>
                      <Button size="icon" variant="outline" onClick={() => handleResize(-1)} disabled={updateHotspot.isPending} aria-label="Shrink hotspot">
                        <Minus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <Card className="mt-4">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium">Shift all hotspots</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="shift-step" className="text-xs text-muted-foreground">Step</Label>
                  <Input
                    id="shift-step"
                    type="number"
                    min={0.25}
                    max={20}
                    step={0.25}
                    value={shiftStep}
                    onChange={(e) => setShiftStep(Math.max(0.25, Math.min(20, Number(e.target.value) || 0.25)))}
                    className="h-8 w-20 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 max-w-44 mx-auto">
                <span />
                <Button size="icon" variant="outline" onClick={() => handleShiftAll(0, -shiftStep)} disabled={updateHotspot.isPending} aria-label="Shift hotspots up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <span />
                <Button size="icon" variant="outline" onClick={() => handleShiftAll(-shiftStep, 0)} disabled={updateHotspot.isPending} aria-label="Shift hotspots left">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="secondary" onClick={() => refetch()} disabled={updateHotspot.isPending} aria-label="Refresh hotspot positions">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => handleShiftAll(shiftStep, 0)} disabled={updateHotspot.isPending} aria-label="Shift hotspots right">
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <span />
                <Button size="icon" variant="outline" onClick={() => handleShiftAll(0, shiftStep)} disabled={updateHotspot.isPending} aria-label="Shift hotspots down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <span />
              </div>
              <p className="text-xs text-muted-foreground">
                Use this when every clickable target is offset in the same direction.
              </p>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardContent className="pt-4 space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> Regenerate image
              </Label>
              <Input
                placeholder="Optional extra instructions (style, lighting…)"
                value={imgInstr}
                onChange={(e) => setImgInstr(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={regenHotspots}
                  onChange={(e) => setRegenHotspots(e.target.checked)}
                />
                Re-detect hotspot positions with vision AI
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    genImage.mutate(
                      {
                        sceneId,
                        customInstructions: imgInstr || undefined,
                        regenerateHotspots: regenHotspots,
                      },
                      { onSuccess: () => refetch() },
                    )
                  }
                  disabled={genImage.isPending}
                >
                  {genImage.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Regenerate image
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    genAudio.mutate({ sceneId, force: false }, { onSuccess: () => refetch() })
                  }
                  disabled={genAudio.isPending}
                >
                  {genAudio.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Volume2 className="h-4 w-4 mr-1" />
                  )}
                  Generate missing audio
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Words ({scene.hotspots.length})</Label>
          {scene.hotspots.map((hs, idx) => {
            const placed = hs.x_pct != null && hs.y_pct != null;
            const isPending = pendingId === hs.id;
            const isSelected = selectedId === hs.id;
            return (
              <div
                key={hs.id}
                className={`p-3 rounded-lg border transition-colors ${
                  isPending
                    ? "border-primary bg-primary/5"
                    : isSelected
                      ? "border-primary/60 bg-primary/5"
                      : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <Badge variant="secondary" className="shrink-0">{idx + 1}</Badge>
                    <div className="min-w-0">
                      <p className="font-semibold truncate" dir="rtl">{hs.word_arabic}</p>
                      <p className="text-xs text-muted-foreground truncate">{hs.word_english}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {hs.word_audio_url ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => new Audio(hs.word_audio_url!).play().catch(() => {})}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-[9px]">No audio</Badge>
                    )}
                    {placed && (
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "ghost"}
                        className="h-7 text-xs"
                        onClick={() => setSelectedId(isSelected ? null : hs.id)}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={isPending ? "default" : placed ? "ghost" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setPendingId(isPending ? null : hs.id)}
                    >
                      {isPending ? "Click image…" : placed ? "Replace" : "Place"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AdminPictureSceneEdit;
