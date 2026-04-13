import { useState, useEffect, useCallback } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, BookOpen, Search } from "lucide-react";

interface BibleReader {
  id: string;
  user_id: string;
  created_at: string;
  email?: string;
}

const BibleAccess = () => {
  const { isAdmin } = useAdminAuth();
  const [readers, setReaders] = useState<BibleReader[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // ── Fetch current bible_reader users ─────────────────────────────────────
  const fetchReaders = useCallback(async () => {
    setLoading(true);
    try {
      // Get all user_roles with bible_reader role.
      // Since we can't join auth.users from the client, we store the user_id
      // and resolve emails via a separate admin lookup when available.
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, created_at")
        .eq("role", "bible_reader")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReaders((data ?? []) as BibleReader[]);
    } catch (err) {
      console.error("Error fetching bible readers:", err);
      toast.error("Failed to load Bible readers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReaders();
  }, [fetchReaders]);

  // ── Add a bible_reader by email ──────────────────────────────────────────
  const addReader = async () => {
    if (!email.trim()) return;
    setAdding(true);

    try {
      let userId: string | null = null;

      // Check if input is a UUID (admin may paste user ID directly)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (uuidRegex.test(email.trim())) {
        userId = email.trim();
      } else {
        // Try to find user by email in the profiles table.
        // This will silently fail if the profiles table doesn't have
        // an email column – that's fine, we'll show a helpful message.
        try {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("user_id")
            .eq("email", email.trim())
            .maybeSingle();

          if (profileData?.user_id) {
            userId = profileData.user_id;
          }
        } catch {
          // profiles table may not have an email column – ignore
        }
      }

      if (!userId) {
        toast.error("User not found", {
          description:
            "Enter a valid user UUID. If your profiles table has an email column you can also enter the user's email.",
        });
        setAdding(false);
        return;
      }

      // Check if already has the role
      const { data: existing } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "bible_reader")
        .maybeSingle();

      if (existing) {
        toast.info("This user already has Bible reading access.");
        setAdding(false);
        return;
      }

      // Insert new role
      const { error: insertError } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "bible_reader" });

      if (insertError) throw insertError;

      toast.success("Bible reading access granted!");
      setEmail("");
      fetchReaders();
    } catch (err) {
      console.error("Error adding bible reader:", err);
      toast.error("Failed to grant access", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAdding(false);
    }
  };

  // ── Remove bible_reader role ─────────────────────────────────────────────
  const removeReader = async (roleRowId: string) => {
    setRemovingId(roleRowId);
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", roleRowId);

      if (error) throw error;

      toast.success("Access revoked");
      setReaders((prev) => prev.filter((r) => r.id !== roleRowId));
    } catch (err) {
      console.error("Error removing bible reader:", err);
      toast.error("Failed to revoke access");
    } finally {
      setRemovingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only admins can manage Bible reading access.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-primary/10 p-2">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Bible Reading Access</h1>
          <p className="text-sm text-muted-foreground">
            Grant or revoke access to the Bible reading feature for specific
            users.
          </p>
        </div>
      </div>

      {/* Add user form */}
      <div className="flex gap-2">
        <Input
          placeholder="User email or UUID"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addReader()}
          className="flex-1"
        />
        <Button onClick={addReader} disabled={adding || !email.trim()}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          <span className="ml-1">Add</span>
        </Button>
      </div>

      {/* Readers table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : readers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No users have Bible reading access yet.</p>
          <p className="text-xs mt-1">
            Add users above to give them access.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {readers.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  {r.user_id}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    disabled={removingId === r.id}
                    onClick={() => removeReader(r.id)}
                  >
                    {removingId === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Users with the <Badge variant="outline" className="text-xs">admin</Badge> role
        automatically have Bible reading access.
      </p>
    </div>
  );
};

export default BibleAccess;
