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
  showDetails: boolean;
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
    title: "Connection problem",
    description: "We couldn't reach the server. Check your internet connection and try again.",
    action: "Try again",
  },
  auth: {
    title: "Your session expired",
    description: "Please sign in again to continue.",
    action: "Sign in",
  },
  unknown: {
    title: "Something went wrong",
    description: "This page hit an error while loading. The details have been logged.",
    action: "Try again",
  },
};

/**
 * Catches render-time React errors and shows a friendly fallback instead of a white screen.
 * Provides specific error messages and recovery actions based on error type.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorType: "unknown", showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorType: classifyError(error), showDetails: false };
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
      this.setState({ error: null, errorType: "unknown", showDetails: false });
    }
  };

  toggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render() {
    if (!this.state.error) return this.props.children;

    const messages = ERROR_MESSAGES[this.state.errorType];

    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
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
                <div>
                  <button
                    type="button"
                    onClick={this.toggleDetails}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    {this.state.showDetails ? "Hide details" : "Show details"}
                  </button>
                  {this.state.showDetails && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                      {String(this.state.error?.message ?? this.state.error)}
                    </pre>
                  )}
                </div>
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
                    Reload page
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

