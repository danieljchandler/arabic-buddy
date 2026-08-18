import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRESET_AVATARS, type PresetAvatarCategory } from "@/data/presetAvatars";

const GROUPS: Array<{ category: PresetAvatarCategory; title: string; desc: string }> = [
  { category: "sadu", title: "Sadu weaves", desc: "Woven medallions in the Bedouin sadu tradition" },
  { category: "motif", title: "Motifs", desc: "Objects from Gulf daily life" },
];

interface AvatarPickerProps {
  /** Current `avatar_url`; a preset is highlighted when it matches. */
  value: string | null;
  onSelect: (src: string) => void;
  disabled?: boolean;
}

/**
 * Grid of on-brand preset avatars. Selecting one hands its public path back to
 * the caller, which stores it in `profiles.avatar_url` like any other image URL.
 */
export function AvatarPicker({ value, onSelect, disabled }: AvatarPickerProps) {
  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <div key={group.category} className="space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">{group.title}</p>
            <p className="text-xs text-muted-foreground">{group.desc}</p>
          </div>
          <div
            role="radiogroup"
            aria-label={group.title}
            className="grid grid-cols-4 gap-3 sm:grid-cols-6"
          >
            {PRESET_AVATARS.filter((a) => a.category === group.category).map((avatar) => {
              const selected = value === avatar.src;
              return (
                <button
                  key={avatar.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={avatar.label}
                  title={avatar.labelAr ? `${avatar.label} — ${avatar.labelAr}` : avatar.label}
                  disabled={disabled}
                  onClick={() => onSelect(avatar.src)}
                  className={cn(
                    "relative aspect-square rounded-full transition-transform",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    selected
                      ? "ring-2 ring-desert-red ring-offset-2 ring-offset-background"
                      : "ring-1 ring-border hover:scale-105",
                  )}
                >
                  <img
                    src={avatar.src}
                    alt=""
                    loading="lazy"
                    width={256}
                    height={256}
                    className="w-full h-full rounded-full object-cover"
                  />
                  {/* Corner badge rather than a full overlay, so the artwork stays readable. */}
                  {selected && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-desert-red ring-2 ring-background">
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
