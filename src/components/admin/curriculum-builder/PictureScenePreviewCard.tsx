import { Badge } from "@/components/ui/badge";
import { ContentPreviewCard } from "./ContentPreviewCard";

export const PictureScenePreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const words = (data.words as Array<Record<string, unknown>>) || [];
  return (
    <ContentPreviewCard
      title={(data.title as string) || "Picture Scene"}
      subtitle={(data.title_arabic as string) || (data.theme as string)}
      icon="🖼️"
      badges={[(data.theme as string), (data.cefr_level as string)].filter(Boolean) as string[]}
      onApprove={onApprove}
      approveLabel={`Create scene & generate image (${words.length} words)`}
      isApproving={isApproving}
    >
      <p className="text-[11px] text-muted-foreground italic line-clamp-2">
        {data.scene_description as string}
      </p>
      <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
        {words.map((w, i) => (
          <Badge key={i} variant="secondary" className="text-[10px]">
            <span dir="rtl">{w.word_arabic as string}</span>
            <span className="mx-1 opacity-50">·</span>
            {w.word_english as string}
          </Badge>
        ))}
      </div>
    </ContentPreviewCard>
  );
};
