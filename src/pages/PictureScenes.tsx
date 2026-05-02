import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { usePublishedScenes, useSceneProgress } from "@/hooks/usePictureScenes";
import { Loader2, ImageIcon, ChevronRight, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PictureScenes = () => {
  const navigate = useNavigate();
  const { data: scenes, isLoading } = usePublishedScenes();
  const { data: progress } = useSceneProgress();
  const completedById = new Map(
    (progress ?? []).map((p: any) => [p.scene_id, p]),
  );

  return (
    <AppShell>
      <div className="mb-6"><HomeButton /></div>
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <ImageIcon className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-heading mb-1">Picture Scenes</h1>
          <p className="text-muted-foreground text-sm">
            Tap objects in a scene, hear them in Arabic, then quiz yourself.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : scenes && scenes.length > 0 ? (
          <div className="space-y-3">
            {scenes.map((scene) => {
              const done = completedById.get(scene.id);
              return (
                <button
                  key={scene.id}
                  onClick={() => navigate(`/picture-scenes/${scene.id}`)}
                  className={cn(
                    "w-full text-left rounded-2xl border-2 border-border bg-card overflow-hidden",
                    "transition-all duration-200 hover:border-primary/40 hover:shadow-lg",
                    "active:scale-[0.98] group",
                  )}
                >
                  <div className="flex">
                    <div className="w-28 h-28 shrink-0 bg-muted relative overflow-hidden">
                      {scene.image_url ? (
                        <img
                          src={scene.image_url}
                          alt={scene.title}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-4 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-base truncate group-hover:text-primary">
                          {scene.title}
                        </h3>
                        {done && (
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate" dir="rtl">
                        {scene.title_arabic}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px]">
                          {scene.theme}
                        </Badge>
                        {scene.cefr_level && (
                          <Badge variant="secondary" className="text-[10px]">
                            {scene.cefr_level}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center pr-3 text-muted-foreground group-hover:text-primary">
                      <ChevronRight className="h-5 w-5" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No picture scenes published yet.</p>
            <p className="text-xs mt-1">Check back soon!</p>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default PictureScenes;
