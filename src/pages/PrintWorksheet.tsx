import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorksheetSheet } from "@/components/worksheet/WorksheetSheet";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { DIALECT_LABELS } from "@/config";
import { toInvokeFailureError } from "@/lib/invokeError";
import { SAMPLE_WORKSHEET } from "@/lib/worksheetSample";
import type { WorksheetSpec } from "../../supabase/functions/_shared/worksheetCore";

/**
 * /print/worksheet — a worksheet built from the learner's weak and due words,
 * laid out for paper. The learner saves it as a PDF from the browser's own
 * print dialog: edge functions cannot run a browser, so the page is the PDF
 * renderer.
 *
 * Nothing is generated on load. A worksheet is a paid model call, so it waits
 * for the button. `?sample=1` shows a fixed Gulf worksheet instead, with no
 * call at all, for checking the print layout.
 *
 * No AppShell and no Ask AI button (it is on ASSISTANT_OFF_ROUTES): whatever
 * is on this page ends up on the paper.
 */
export default function PrintWorksheet() {
  useDocumentTitle("Worksheet");
  const [params] = useSearchParams();
  const { activeDialect } = useDialect();
  const sample = params.get("sample") === "1";
  const [generated, setGenerated] = useState<WorksheetSpec | null>(null);
  const spec = generated ?? (sample ? SAMPLE_WORKSHEET : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("generate-worksheet", {
        body: { dialect: activeDialect },
      });
      if (invokeError) throw await toInvokeFailureError(invokeError, data, "The worksheet couldn't be made. Try again.");
      const next = (data as { spec?: WorksheetSpec } | null)?.spec;
      if (!next) throw new Error("The worksheet came back empty. Try again.");
      setGenerated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The worksheet couldn't be made. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <div className="ws-screen-only mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/my-words">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            My words
          </Link>
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={generate} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {generated ? "Make another" : "Make my worksheet"}
        </Button>
        <Button onClick={() => window.print()} disabled={!spec}>
          <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
          Print or save as PDF
        </Button>
      </div>

      {error && (
        <p role="alert" className="ws-screen-only mx-auto max-w-3xl px-4 pb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {spec ? (
        <div className="bg-white shadow-sm print:shadow-none sm:mx-auto sm:max-w-[210mm]">
          <WorksheetSheet spec={spec} />
        </div>
      ) : (
        <div className="ws-screen-only mx-auto max-w-xl px-4 py-10 text-center">
          <h1 className="text-xl font-semibold">A worksheet from your own words</h1>
          <p className="mt-2 text-muted-foreground">
            One page of {DIALECT_LABELS[activeDialect]} practice built from the words you find hardest and the ones due
            for review: matching, fill the gaps, a short conversation, spot the Fusha, and a few lines to write. Print it,
            or save it as a PDF from the print dialog.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <Link className="underline" to="/print/worksheet?sample=1">
              See a sample first
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
