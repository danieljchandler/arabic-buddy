import { EDGE_BUILD } from "@/lib/edgeBuildStatus";

/**
 * What the analysis recorded about its translation ensemble, in
 * `engines_used.translation` — written by analyze-gulf-arabic.
 */
export interface TranslationTier {
  name: string;
  via?: string;
  weight?: number;
  status?: "ok" | "failed" | "parse_failed" | "empty" | string;
  latency_ms?: number;
  lines_won?: number;
  error?: string;
}

export interface TranslationProvenance {
  strategy?: string;
  build?: string;
  merge_model?: string;
  degraded?: boolean;
  active_models?: number;
  lines?: number;
  blank_after_ensemble?: number;
  cheap_fill?: number;
  tiers?: TranslationTier[];
  shaheen?: { attempted?: boolean; succeeded?: boolean; filled?: number; skip_reason?: string };
}

interface TranslationProvenancePanelProps {
  enginesUsed: unknown;
  /** The build this app was compiled against; the analysis names its own. */
  expectedBuild?: string;
}

/** "anthropic/claude-sonnet-5" → "claude-sonnet-5". */
const shortName = (id: string) => id.replace(/^[^/]+\//, "");

const seconds = (ms?: number) =>
  typeof ms === "number" && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : null;

function describeTier(tier: TranslationTier): string {
  const parts: string[] = [];
  const took = seconds(tier.latency_ms);
  if (tier.status === "ok") {
    parts.push("answered");
    if (took) parts.push(`in ${took}`);
    if (typeof tier.lines_won === "number") parts.push(`— won ${tier.lines_won} line${tier.lines_won === 1 ? "" : "s"}`);
    return parts.join(" ");
  }
  const why =
    tier.status === "parse_failed" ? "answered, but not with usable JSON"
    : tier.status === "empty" ? "answered with nothing"
    : "failed";
  parts.push(why);
  if (took) parts.push(`after ${took}`);
  if (tier.error) parts.push(`— ${tier.error}`);
  return parts.join(" ");
}

/**
 * The translation ensemble, model by model, on the video's edit page.
 *
 * A transcript that arrives without English used to be a dead end for the
 * person looking at it: the reasons lived in the function logs, and the app
 * had no way to say whether the models were down, slow, or never asked.
 * This reads what the analysis recorded — which of the three models answered,
 * how long each took, what the failed ones said, how many lines a cheaper
 * fallback filled — and which build of the analysis produced it, since the
 * app's build banner probes only the pipeline function and an analysis left
 * behind by a partial deploy is otherwise invisible.
 */
export function TranslationProvenancePanel({
  enginesUsed,
  expectedBuild = EDGE_BUILD,
}: TranslationProvenancePanelProps) {
  const provenance = (enginesUsed as { translation?: TranslationProvenance } | null | undefined)
    ?.translation;
  if (!provenance || typeof provenance !== "object") return null;

  const tiers = Array.isArray(provenance.tiers) ? provenance.tiers : [];
  const answered = typeof provenance.active_models === "number"
    ? provenance.active_models
    : tiers.filter((t) => t.status === "ok").length;
  const total = tiers.length || 3;
  const none = answered === 0;
  const behind = Boolean(provenance.build) && provenance.build !== expectedBuild;

  return (
    <div
      className={`p-3 rounded-lg border text-sm space-y-1 ${
        none ? "bg-destructive/10 border-destructive/40" : "bg-muted/50 border-border"
      }`}
      data-testid="translation-provenance"
    >
      <p className="font-medium">
        Translation — {answered} of {total} models answered
        {none ? ": no English came from the ensemble" : ""}
      </p>
      {tiers.length > 0 && (
        <ul className="text-muted-foreground list-disc ps-5 space-y-0.5">
          {tiers.map((tier) => (
            <li key={tier.name}>
              <span className="font-medium">{shortName(tier.name)}</span>
              {tier.via ? ` via ${tier.via}` : ""}: {describeTier(tier)}
            </li>
          ))}
        </ul>
      )}
      {typeof provenance.blank_after_ensemble === "number" && provenance.blank_after_ensemble > 0 && (
        <p className="text-muted-foreground">
          {provenance.blank_after_ensemble} line{provenance.blank_after_ensemble === 1 ? "" : "s"} left blank by the
          ensemble; {provenance.cheap_fill ?? 0} filled by the per-line fallback translator.
        </p>
      )}
      {provenance.shaheen?.attempted && (
        <p className="text-muted-foreground">
          Shaheen-MT tiebreak {provenance.shaheen.succeeded ? "ran" : "did not run"}
          {typeof provenance.shaheen.filled === "number" ? `, filled ${provenance.shaheen.filled}` : ""}
          {provenance.shaheen.skip_reason ? ` (${provenance.shaheen.skip_reason})` : ""}.
        </p>
      )}
      {provenance.build && (
        <p className={behind ? "text-destructive" : "text-muted-foreground"}>
          Analysis build {provenance.build}
          {provenance.merge_model ? ` · merge on ${shortName(provenance.merge_model)}` : ""}
          {behind
            ? ` — this app expects ${expectedBuild}. Deploy analyze-gulf-arabic; the build banner only checks the pipeline function.`
            : ""}
        </p>
      )}
    </div>
  );
}
