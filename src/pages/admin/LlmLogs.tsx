import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Loader2, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * LLM Logs page — the llm_usage_logs table doesn't exist yet.
 * Show a placeholder until the table is created.
 */
const LlmLogs = () => {
  const { isAdmin } = useAdminAuth();

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            LLM Usage Logs
          </CardTitle>
          <CardDescription>
            The llm_usage_logs table hasn't been created yet. LLM usage is logged to console in edge function logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6 text-center text-muted-foreground">
          No queries logged yet. Check edge function logs for LLM usage details.
        </CardContent>
      </Card>
    </div>
  );
};

export default LlmLogs;