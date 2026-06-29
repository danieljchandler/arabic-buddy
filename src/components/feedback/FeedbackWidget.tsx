import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquarePlus, Bug, Lightbulb, HelpCircle, Heart, MoreHorizontal, Loader2, Camera, X } from "lucide-react";
import html2canvas from "html2canvas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBetaTester } from "@/hooks/useBetaTester";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

type FeedbackType = "bug" | "idea" | "confusing" | "praise" | "other";

const TYPES: { value: FeedbackType; label: string; icon: typeof Bug; color: string }[] = [
  { value: "bug", label: "Bug", icon: Bug, color: "bg-red-500/10 text-red-600 border-red-500/30" },
  { value: "idea", label: "Idea", icon: Lightbulb, color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  { value: "confusing", label: "Confusing", icon: HelpCircle, color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  { value: "praise", label: "Praise", icon: Heart, color: "bg-pink-500/10 text-pink-600 border-pink-500/30" },
  { value: "other", label: "Other", icon: MoreHorizontal, color: "bg-muted text-muted-foreground border-border" },
];

// Keep a small rolling buffer of recent console errors for context.
const recentErrors: string[] = [];
if (typeof window !== "undefined" && !(window as any).__feedbackErrorHook) {
  (window as any).__feedbackErrorHook = true;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const line = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")
        .slice(0, 500);
      recentErrors.push(`[${new Date().toISOString()}] ${line}`);
      if (recentErrors.length > 20) recentErrors.shift();
    } catch {
      /* ignore */
    }
    origError(...args);
  };
}

export function FeedbackWidget() {
  const { user } = useAuth();
  const { isBetaTester } = useBetaTester();
  const { activeDialect } = useDialect();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [includeShot, setIncludeShot] = useState(true);
  const [shot, setShot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const captureScreenshot = async () => {
    setCapturing(true);
    try {
      // Briefly let the UI settle (sheet animations, etc.)
      await new Promise((r) => setTimeout(r, 50));
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff",
        scale: Math.min(window.devicePixelRatio || 1, 2),
        ignoreElements: (el) =>
          el.getAttribute?.("data-feedback-ignore") === "true" ||
          el.closest?.("[data-feedback-ignore='true']") !== null,
      });
      // Compress
      const maxW = 1280;
      const ratio = canvas.width > maxW ? maxW / canvas.width : 1;
      const out = document.createElement("canvas");
      out.width = Math.round(canvas.width * ratio);
      out.height = Math.round(canvas.height * ratio);
      const ctx = out.getContext("2d");
      if (ctx) ctx.drawImage(canvas, 0, 0, out.width, out.height);
      setShot(out.toDataURL("image/jpeg", 0.7));
    } catch (e) {
      console.error("Screenshot failed:", e);
      toast.error("Couldn't capture screenshot.");
    } finally {
      setCapturing(false);
    }
  };

  const openWithCapture = async () => {
    if (includeShot && !shot) {
      await captureScreenshot();
    }
    setOpen(true);
  };


  // Cmd/Ctrl + / to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hidden = useMemo(() => {
    // Hide on auth / onboarding / admin (admin already has its own feedback admin page)
    return (
      pathname.startsWith("/auth") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/reset-password")
    );
  }, [pathname]);

  if (!user || !isBetaTester || hidden) return null;

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < 3) {
      toast.error("Please write a few more words.");
      return;
    }
    setSubmitting(true);
    try {
      let screenshotPath: string | null = null;
      if (includeShot && shot) {
        try {
          const blob = await (await fetch(shot)).blob();
          const path = `${user.id}/${crypto.randomUUID()}.jpg`;
          const { error: upErr } = await supabase.storage
            .from("feedback-screenshots")
            .upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (upErr) throw upErr;
          screenshotPath = path;
        } catch (e) {
          console.error("Screenshot upload failed:", e);
          toast.error("Screenshot upload failed — sending without it.");
        }
      }
      const ctx = {
        dialect: activeDialect,
        viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        language: typeof navigator !== "undefined" ? navigator.language : null,
        appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? null,
        recentErrors: recentErrors.slice(-10),
      };
      const { error } = await supabase.from("beta_feedback").insert({
        user_id: user.id,
        type,
        message: trimmed,
        route: pathname,
        context: ctx as never,
        screenshot_url: screenshotPath,
      });
      if (error) throw error;
      toast.success("Thanks — feedback sent!");
      setMessage("");
      setType("bug");
      setShot(null);
      setOpen(false);
    } catch (err) {
      console.error("Failed to send feedback:", err);
      toast.error("Could not send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <>
      <button
        type="button"
        data-feedback-ignore="true"
        onClick={openWithCapture}
        aria-label="Send feedback"
        className={cn(
          "fixed z-40 right-3 bottom-20 md:bottom-6 md:right-6",
          "h-12 w-12 rounded-full shadow-lg",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          "flex items-center justify-center transition-transform active:scale-95",
        )}
      >
        {capturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquarePlus className="h-5 w-5" />}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent data-feedback-ignore="true" side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">

          <SheetHeader className="text-left">
            <SheetTitle>Send feedback</SheetTitle>
            <SheetDescription>
              Tell us what's broken, confusing, or great. We'll see your current page and dialect automatically.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Type</div>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  const active = type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        active ? t.color : "bg-background text-muted-foreground border-border hover:bg-muted",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="fb-msg" className="text-sm font-medium block mb-2">
                What happened?
              </label>
              <Textarea
                id="fb-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 4000))}
                placeholder="Steps to reproduce, what you expected, what you saw…"
                rows={5}
                autoFocus
              />
              <div className="mt-1 text-xs text-muted-foreground text-right">{message.length}/4000</div>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              Attached automatically: page <span className="font-mono">{pathname}</span> · {activeDialect} · viewport · last console errors
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || message.trim().length < 3}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send feedback"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
