import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

function isJaisLlm(llmUsed: string) {
  return llmUsed.startsWith('Jais');
}

const LlmLogs = () => {
  const { isAdmin } = useAdminAuth();

  const { data: logs, isLoading } = useQuery({
    queryKey: ['llm-usage-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('llm_usage_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: isAdmin,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const latest = logs?.[0];

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Most recent query — the answer to "which LLM was used?" */}
      {latest ? (
        <Card className={`border-2 ${isJaisLlm(latest.llm_used) ? 'border-primary/50 bg-primary/5' : 'border-secondary/50 bg-secondary/5'}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Most Recent Query</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">LLM used</p>
                <Badge variant={isJaisLlm(latest.llm_used) ? 'default' : 'secondary'} className="text-sm px-3 py-1">
                  {latest.llm_used}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Phrase</p>
                <p className="font-medium italic">{latest.phrase ?? '—'}</p>
              </div>
              <div className="ml-auto">
                <p className="text-xs text-muted-foreground mb-1">Time</p>
                <p className="text-sm text-muted-foreground">{new Date(latest.created_at).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-muted-foreground">No queries logged yet.</CardContent>
        </Card>
      )}

      {/* Full log table */}
      <Card>
        <CardHeader>
          <CardTitle>LLM Usage Logs</CardTitle>
          <CardDescription>
            Which language model handled each "How do I say" request
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs && logs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>LLM Used</TableHead>
                  <TableHead>Phrase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">{log.function_name}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isJaisLlm(log.llm_used) ? 'default' : 'secondary'}>
                        {log.llm_used}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{log.phrase ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center py-8 text-muted-foreground">No LLM usage logs yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LlmLogs;
