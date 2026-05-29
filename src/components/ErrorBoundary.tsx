import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logClientError } from "@/lib/errorLog";

type Props = {
  children: React.ReactNode;
  name?: string;
};

type State = {
  error: Error | null;
  errorType: "network" | "auth" | "unknown";
};

function classifyError(error: Error): "network" | "auth" | "unknown" {
  const msg = error.message?.toLowerCase() || "";
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed to load") || msg.includes("timeout")) {
    return "network";
  }
  if (msg.includes("auth") || msg.includes("jwt") || msg.includes("token") || msg.includes("unauthorized") || msg.includes("401")) {
    return "auth";
  }
  return "unknown";
}

const ERROR_MESSAGES: Record<string, { title: string; description: string; action: string }> = {
  network: {
    title: "مشكلة في الاتصال",
    description: "لم نتمكن من الاتصال بالخادم. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.",
    action: "إعادة المحاولة",
  },
  auth: {
    title: "انتهت صلاحية الجلسة",
    description: "يبدو أن جلستك قد انتهت. يرجى تسجيل الدخول مرة أخرى.",
    action: "تسجيل الدخول",
  },
  unknown: {
    title: "حدث خطأ في الصفحة",
    description: "حصل خطأ أثناء عرض هذه الصفحة. تم تسجيل التفاصيل في الكونسول.",
    action: "إعادة المحاولة",
  },
};

/**
 * Catches render-time React errors and shows a friendly fallback instead of a white screen.
 * Provides specific error messages and recovery actions based on error type.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorType: "unknown" };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorType: classifyError(error) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error", {
      name: this.props.name,
      error,
      errorInfo,
    });
    void logClientError({
      message: error.message || String(error),
      stack: error.stack ?? null,
      meta: { boundary: this.props.name, componentStack: errorInfo.componentStack },
    });
  }

  handleRetry = () => {
    if (this.state.errorType === "auth") {
      window.location.href = "/auth";
    } else {
      this.setState({ error: null, errorType: "unknown" });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const messages = ERROR_MESSAGES[this.state.errorType];

    return (
      <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>{messages.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {messages.description}
              </p>
              {this.state.errorType === "unknown" && (
                <pre className="text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                  {String(this.state.error?.message ?? this.state.error)}
                </pre>
              )}
              <div className="flex gap-2">
                <Button type="button" onClick={this.handleRetry}>
                  {messages.action}
                </Button>
                {this.state.errorType !== "auth" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    إعادة تحميل الصفحة
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}

