import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useDialect } from "@/contexts/DialectContext";
import { takeSharedPayload, stashSharedPayload, setShareHandoff } from "@/lib/shareInbox";
import { classifyShare, type ShareRoute } from "@/lib/shareRouting";
import { toast } from "sonner";
import {
  Share2,
  Loader2,
  Sparkles,
  Languages,
  FileAudio,
  ImageIcon,
  Twitter,
  Clapperboard,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/**
 * Landing page for content shared into the app.
 *
 * Android: the share sheet POSTs to /share-target, the service worker stashes
 * the payload and redirects here. iOS has no Web Share Target, so this page
 * also accepts ?text=/&url= query params (usable from an iOS Shortcut) and
 * offers a manual paste box as the everything-else fallback.
 *
 * Obvious payloads route deterministically (src/lib/shareRouting.ts); free
 * text and screenshots are screened by the screen-shared-content function,
 * which also converts them (e.g. extracts the Arabic out of a chat
 * screenshot) before the handoff.
 */

type Phase =
  | { name: "resolving" }
  | { name: "screening"; detail: string }
  | { name: "pipeline-running"; url: string }
  | {
      name: "pipeline-done";
      videoId: string;
      title: string;
      alreadyExists: boolean;
      adminPath: string;
    }
  | { name: "pipeline-failed"; url: string; message: string }
  | { name: "video-unsupported"; url: string }
  | { name: "manual"; note: string | null };

/** Downscale a shared image for the screening call — triage needs legibility,
 * not pixels, and share sheets hand over multi-MB photos. */
async function imageToScreeningDataUri(file: File, maxDim = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

async function readInvokeError(err: unknown): Promise<string> {
  if (!err || typeof err !== "object") return String(err);
  const context = (err as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json();
      if (body?.message) return body.message;
      if (body?.error) return body.error;
    } catch {
      /* ignore parse failure */
    }
  }
  return (err as Error).message ?? "Unknown error";
}

const Share = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isAdmin, loading: rolesLoading } = useAdminAuth();
  const { activeDialect } = useDialect();

  const [phase, setPhase] = useState<Phase>({ name: "resolving" });
  const [manualText, setManualText] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const startedRef = useRef(false);

  const goTo = useCallback(
    (path: string, label: string) => {
      toast.success(`Routed to ${label}`, { duration: 3500 });
      navigate(`${path}?shared=1`, { replace: true });
    },
    [navigate],
  );

  const runVideoPipeline = useCallback(
    async (url: string) => {
      setPhase({ name: "pipeline-running", url });
      const { data, error } = await supabase.functions.invoke("ingest-shared-video", {
        body: { url, dialect: activeDialect },
      });
      if (error || !data?.success) {
        const message = error ? await readInvokeError(error) : (data?.message ?? data?.error ?? "Unknown error");
        setPhase({ name: "pipeline-failed", url, message });
        return;
      }
      setPhase({
        name: "pipeline-done",
        videoId: data.videoId,
        title: data.title ?? "Untitled video",
        alreadyExists: !!data.alreadyExists,
        adminPath: data.adminPath ?? `/admin/videos/${data.videoId}/edit`,
      });
    },
    [activeDialect],
  );

  const screenContent = useCallback(
    async (input: { text?: string; imageFile?: File }) => {
      setPhase({
        name: "screening",
        detail: input.imageFile ? "Reading your image…" : "Reading your text…",
      });

      let imageBase64: string | undefined;
      if (input.imageFile) {
        try {
          imageBase64 = await imageToScreeningDataUri(input.imageFile);
        } catch {
          // Screening can't see it; the meme analyzer's own OCR still can.
          setShareHandoff({ kind: "file", file: input.imageFile });
          goTo("/meme", "Meme Analyzer");
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("screen-shared-content", {
        body: { text: input.text, imageBase64, dialect: activeDialect },
      });
      if (error) {
        const message = await readInvokeError(error);
        toast.error("Couldn't screen the shared content", { description: message });
        setPhase({ name: "manual", note: input.text ?? null });
        if (input.text) setManualText(input.text);
        return;
      }

      const destination: string = data?.destination ?? "none";
      const extractedText: string = typeof data?.extractedText === "string" ? data.extractedText : "";

      if (destination === "translate" && extractedText) {
        setShareHandoff({ kind: "text", text: extractedText });
        goTo("/translate", "Translate");
      } else if (destination === "how_do_i_say" && extractedText) {
        setShareHandoff({ kind: "text", text: extractedText });
        goTo("/how-do-i-say", "How Do I Say");
      } else if (destination === "meme" && input.imageFile) {
        setShareHandoff({ kind: "file", file: input.imageFile });
        goTo("/meme", "Meme Analyzer");
      } else {
        setPhase({ name: "manual", note: input.text ?? null });
        if (input.text) setManualText(input.text);
        if (data?.reason) {
          toast.info("Not sure where this belongs", { description: data.reason });
        }
      }
    },
    [activeDialect, goTo],
  );

  const dispatch = useCallback(
    async (route: ShareRoute) => {
      switch (route.action) {
        case "transcribe-file":
          setShareHandoff({ kind: "file", file: route.file });
          goTo("/transcribe", "Transcribe");
          break;
        case "transcribe-url":
          setShareHandoff({ kind: "url", url: route.url });
          goTo("/transcribe", "Transcribe");
          break;
        case "meme-file":
          setShareHandoff({ kind: "file", file: route.file });
          goTo("/meme", "Meme Analyzer");
          break;
        case "learn-from-x":
          setShareHandoff({ kind: "url", url: route.url });
          goTo("/learn-from-x", "Learn from X");
          break;
        case "video-pipeline":
          await runVideoPipeline(route.url);
          break;
        case "video-url-unsupported":
          setPhase({ name: "video-unsupported", url: route.url });
          break;
        case "screen-text":
          await screenContent({ text: route.text });
          break;
        case "screen-image":
          await screenContent({ imageFile: route.file });
          break;
        case "empty":
          setPhase({ name: "manual", note: null });
          break;
      }
    },
    [goTo, runVideoPipeline, screenContent],
  );

  useEffect(() => {
    if (authLoading || rolesLoading || startedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const paramPayload = {
      title: params.get("title") ?? "",
      text: params.get("text") ?? "",
      url: params.get("url") ?? "",
    };
    if (params.get("error") === "receive_failed") {
      toast.error("Receiving the share failed", { description: "Try sharing again, or paste it below." });
    }

    if (!isAuthenticated) {
      // Park any query-param payload with the inbox (the service-worker stash
      // is already persistent) and bounce through login; /auth returns here.
      startedRef.current = true;
      void (async () => {
        if (paramPayload.text || paramPayload.url) await stashSharedPayload(paramPayload);
        navigate("/auth", { replace: true, state: { from: { pathname: "/share" } } });
      })();
      return;
    }

    startedRef.current = true;
    void (async () => {
      const stashed = await takeSharedPayload();
      const payload = {
        title: stashed?.title || paramPayload.title,
        text: stashed?.text || paramPayload.text,
        url: stashed?.url || paramPayload.url,
        files: stashed?.files ?? [],
      };
      await dispatch(classifyShare({ ...payload, isAdmin }));
    })();
  }, [authLoading, rolesLoading, isAuthenticated, isAdmin, navigate, dispatch]);

  const onManualSubmit = async () => {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    setManualBusy(true);
    try {
      await dispatch(classifyShare({ title: "", text: trimmed, url: "", files: [], isAdmin }));
    } finally {
      setManualBusy(false);
    }
  };

  const busy =
    phase.name === "resolving" || phase.name === "screening" || phase.name === "pipeline-running";

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <PageCorner />
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Shared with Hakiya
          </h1>
          <div className="w-9" />
        </div>

        {busy && (
          <Card>
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">
                {phase.name === "pipeline-running"
                  ? "Starting the video pipeline…"
                  : phase.name === "screening"
                    ? phase.detail
                    : "Checking what you shared…"}
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                {phase.name === "pipeline-running"
                  ? "Creating the video and extracting its audio for transcription."
                  : "AI picks the right tool and converts the content for it."}
              </p>
            </CardContent>
          </Card>
        )}

        {phase.name === "pipeline-done" && (
          <Card className="border-primary/40">
            <CardContent className="p-6 space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
              <div>
                <p className="font-semibold">
                  {phase.alreadyExists ? "Already in Discover" : "Pipeline started!"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {phase.alreadyExists
                    ? `"${phase.title}" was ingested before — no duplicate created.`
                    : `"${phase.title}" was added. Audio is being extracted and transcribed now; results appear on the admin video page automatically.`}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link to={phase.adminPath}>Open in Admin</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/videos">All videos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase.name === "pipeline-failed" && (
          <Card className="border-destructive/40">
            <CardContent className="p-6 space-y-4 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
              <div>
                <p className="font-semibold">Couldn't start the pipeline</p>
                <p className="text-sm text-muted-foreground mt-1">{phase.message}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => void runVideoPipeline(phase.url)}>
                  Try again
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShareHandoff({ kind: "url", url: phase.url });
                    goTo("/transcribe", "Transcribe");
                  }}
                >
                  Transcribe it instead
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase.name === "video-unsupported" && (
          <Card>
            <CardContent className="p-6 space-y-4 text-center">
              <Clapperboard className="h-10 w-10 text-muted-foreground mx-auto" />
              <div>
                <p className="font-semibold">Video links need the team</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Importing TikTok/YouTube links is handled by our content team. You can still share
                  the clip's audio file to get it transcribed, or a screenshot to analyze it.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/transcribe">Transcribe audio</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/discover">Browse Discover</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase.name === "manual" && (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Paste or share Arabic text, a link, a voice note, or a screenshot — it gets routed
                  to the right tool automatically.
                </p>
                <Textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Paste text or a link here…"
                  className="min-h-[100px]"
                />
                <div className="flex justify-end">
                  <Button onClick={() => void onManualSubmit()} disabled={manualBusy || !manualText.trim()}>
                    {manualBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Routing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" /> Route it
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-3">Or go straight to a tool:</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline" size="sm" className="justify-start">
                    <Link to="/translate">
                      <Languages className="h-4 w-4 mr-2" /> Translate
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="justify-start">
                    <Link to="/transcribe">
                      <FileAudio className="h-4 w-4 mr-2" /> Transcribe
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="justify-start">
                    <Link to="/meme">
                      <ImageIcon className="h-4 w-4 mr-2" /> Meme Analyzer
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="justify-start">
                    <Link to="/learn-from-x">
                      <Twitter className="h-4 w-4 mr-2" /> Learn from X
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default Share;
