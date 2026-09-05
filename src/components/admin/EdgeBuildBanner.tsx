import { useState } from "react";
import { AlertTriangle, Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEdgeBuildStatus } from "@/hooks/useEdgeBuildStatus";
import { PIPELINE_FUNCTIONS, deployInstruction } from "@/lib/edgeBuildStatus";

/**
 * Says when the backend is running an older build than this app.
 *
 * Edge functions do not deploy with the app. On Lovable Cloud the Supabase
 * project is managed, so there is no access token to give CI and deploying
 * stays a separate manual step — which means the two halves can disagree, and
 * nothing anywhere said so. A transcription bug was chased through three
 * rounds of "still broken" against a backend still serving the previous copy
 * of the fix.
 *
 * This is where that stops being something you find out by debugging. It only
 * renders for someone who can do something about it, only when the builds
 * actually differ, and it carries the request to paste rather than making
 * anyone reconstruct which of 119 functions to name.
 */
export function EdgeBuildBanner({ enabled = true }: { enabled?: boolean }) {
  const { data: status } = useEdgeBuildStatus({ enabled });
  const [copied, setCopied] = useState(false);

  if (!status?.needsDeploy) return null;

  const request = [
    `Deploy these Supabase edge functions: ${PIPELINE_FUNCTIONS.join(", ")}.`,
    "Do not change any code. Merging does not deploy them, so they are still",
    "running an older version than the repository. Confirm both deployed, and",
    "paste any deploy error verbatim rather than reporting success.",
  ].join(" ");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused often enough (permissions, insecure
      // context) that failing here must not hide the request — it is on
      // screen either way, and selectable.
      setCopied(false);
    }
  };

  return (
    <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30" data-testid="edge-build-banner">
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium">The backend is running older code than this app</p>
            <p className="text-xs">
              {deployInstruction(PIPELINE_FUNCTIONS)} Until then, transcription runs use the
              previous version, and a fix that has already landed will look like it did nothing.
            </p>
            <p className="text-xs text-muted-foreground">
              {status.deployed
                ? `Deployed ${status.deployed}, this app expects ${status.expected}.`
                : `This app expects ${status.expected}; the backend did not report a build.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? "Copied" : "Copy the deploy request"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
