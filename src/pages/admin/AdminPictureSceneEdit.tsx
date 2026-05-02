import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Wand2,
  Volume2,
  Play,
  Save,
  Eye,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { SceneCanvas } from "@/components/picture-scenes/SceneCanvas";
import {
  useScene,
  useGenerateSceneImage,
  useGenerateSceneAudio,
  useUpdateHotspot,
  usePublishScene,
} from "@/hooks/usePictureScenes";

const AdminPictureSceneEdit = () => {
  const { sceneId } = useParams<{ sceneId: string }>();
  const navigate = useNavigate();
  const { data: scene, isLoading, refetch } = useScene(sceneId);
  const genImage = useGenerateSceneImage();
  const genAudio = useGenerateSceneAudio();
  const updateHotspot = useUpdateHotspot();
  const publish = usePublishScene();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [imgInstr, setImgInstr] = useState("");
  const [regenHotspots, setRegenHotspots] = useState(true);

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
            pendingPlacementId={pendingId}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {pendingId
              ? "Click on the image to place this word."
              : "Drag a circle to reposition it. Use the list on the right to place words missing coordinates."}
          </p>

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
          {scene.hotspots.map((hs) => {
            const placed = hs.x_pct != null && hs.y_pct != null;
            const isPending = pendingId === hs.id;
            return (
              <div
                key={hs.id}
                className={`p-3 rounded-lg border transition-colors ${
                  isPending ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate" dir="rtl">{hs.word_arabic}</p>
                    <p className="text-xs text-muted-foreground truncate">{hs.word_english}</p>
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
                    <Button
                      size="sm"
                      variant={isPending ? "default" : placed ? "ghost" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setPendingId(isPending ? null : hs.id)}
                    >
                      {isPending ? "Click image…" : placed ? "Move" : "Place"}
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
