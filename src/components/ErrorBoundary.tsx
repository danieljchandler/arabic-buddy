import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  children: React.ReactNode;
  name?: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches render-time React errors and shows a friendly fallback instead of a white screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error", {
      name: this.props.name,
      error,
      errorInfo,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>حدث خطأ في الصفحة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                حصل خطأ أثناء عرض هذه الصفحة. تم تسجيل التفاصيل في الكونسول.
              </p>
              <pre className="text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                {String(this.state.error?.message ?? this.state.error)}
              </pre>
              <div className="flex gap-2">
                <Button type="button" onClick={() => window.location.reload()}>
                  إعادة تحميل
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => this.setState({ error: null })}
                >
                  محاولة المتابعة
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}
