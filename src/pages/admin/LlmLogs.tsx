import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

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

  return (
    <div className="container mx-auto px-4 py-8">
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
                      <Badge variant={log.llm_used.startsWith('Jais') ? 'default' : 'secondary'}>
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
