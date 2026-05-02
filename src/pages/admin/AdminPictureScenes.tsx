import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ImageIcon, Plus, Pencil, Eye, EyeOff } from "lucide-react";
import type { PictureScene } from "@/hooks/usePictureScenes";

const AdminPictureScenes = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();

  const { data: scenes, isLoading } = useQuery({
    queryKey: ["admin-picture-scenes", activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picture_scenes")
        .select("*")
        .eq("dialect", activeDialect)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PictureScene[];
    },
  });

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Picture Scenes</h1>
          <p className="text-sm text-muted-foreground">
            Review AI-generated themed scenes for {activeDialect} learners.
          </p>
        </div>
        <Button onClick={() => navigate("/admin/curriculum-builder")}>
          <Plus className="h-4 w-4 mr-2" />
          New (Curriculum Builder)
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !scenes || scenes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No scenes yet. Generate one in the Curriculum Builder.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenes.map((scene) => (
            <Card key={scene.id} className="overflow-hidden">
              <div className="aspect-[4/3] bg-muted relative">
                {scene.image_url ? (
                  <img
                    src={scene.image_url}
                    alt={scene.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                    Image generating…
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <Badge
                    variant={scene.status === "published" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {scene.status === "published" ? (
                      <Eye className="h-3 w-3 mr-1" />
                    ) : (
                      <EyeOff className="h-3 w-3 mr-1" />
                    )}
                    {scene.status}
                  </Badge>
                </div>
              </div>
              <CardContent className="pt-4">
                <h3 className="font-semibold truncate">{scene.title}</h3>
                <p className="text-sm text-muted-foreground truncate" dir="rtl">
                  {scene.title_arabic}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <Badge variant="outline" className="text-[10px]">
                    {scene.theme}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => navigate(`/admin/picture-scenes/${scene.id}`)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminPictureScenes;
