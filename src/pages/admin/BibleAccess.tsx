import { useState, useEffect, useCallback } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Shield, Search, MailQuestion, Link2 } from "lucide-react";
import { MANAGED_ROLES, ROLE_LABELS, isElevatedRole, type ManagedRole } from "@/lib/rbac";
import { describeGrantResult, roleInviteMessage, type GrantResult } from "@/lib/roleGrants";

interface ManagedRoleRow {
  id: string;
  user_id: string;
  role: ManagedRole;
  created_at: string;
  email: string | null;
}

interface PendingGrantRow {
  id: string;
  email: string;
  role: ManagedRole;
  created_at: string;
}

const BibleAccess = () => {
  const { isAdmin, user } = useAdminAuth();
  const [rows, setRows] = useState<ManagedRoleRow[]>([]);
  const [pending, setPending] = useState<PendingGrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [selectedRole, setSelectedRole] = useState<ManagedRole>("bible_reader");
  const [filterRole, setFilterRole] = useState<ManagedRole | "all">("all");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Set while an elevated grant waits on the confirmation dialog.
  const [confirming, setConfirming] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_managed_roles");
      if (error) throw error;
      setRows((data ?? []) as ManagedRoleRow[]);
    } catch (err) {
      console.error("Error fetching managed roles:", err);
      toast.error("Failed to load role assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("admin_list_pending_role_grants");
      if (error) throw error;
      setPending((data ?? []) as PendingGrantRow[]);
    } catch (err) {
      // Its own catch, and no spinner of its own: the invitations are a second
      // list on the same page, and losing them must not blank out the record of
      // who actually holds what.
      console.error("Error fetching pending role grants:", err);
      toast.error("Failed to load pending invitations");
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchPending();
  }, [fetchRoles, fetchPending]);

  /**
   * Hand the identifier to the database and report whichever of the four
   * outcomes came back. The client never resolves the address itself — only a
   * security-definer function can see `auth.users`, and it is also the only
   * place that knows whether an unknown address should become an invitation.
   */
  const grant = async () => {
    const rawIdentifier = identifier.trim();
    if (!rawIdentifier) return;
    setAdding(true);

    try {
      const { data, error } = await supabase.rpc("admin_grant_role_by_email", {
        _identifier: rawIdentifier,
        _role: selectedRole,
      });
      if (error) throw error;

      const result = (data ?? [])[0] as GrantResult | undefined;
      if (!result) throw new Error("The role grant returned no result.");

      const message = describeGrantResult(result, selectedRole, rawIdentifier);

      if (message.tone === "error") {
        toast.error(message.title, { description: message.description });
        return;
      }

      if (message.tone === "info") {
        toast.info(message.title, { description: message.description });
      } else {
        toast.success(message.title, { description: message.description });
      }

      setIdentifier("");
      await Promise.all([fetchRoles(), fetchPending()]);
    } catch (err) {
      console.error("Error adding role:", err);
      toast.error("Failed to grant role", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAdding(false);
    }
  };

  const addRole = () => {
    if (!identifier.trim()) return;
    // Admin is the one grant that hands over this page itself, so it stops for
    // a second pair of eyes — the same person's, a moment later.
    if (isElevatedRole(selectedRole)) {
      setConfirming(true);
      return;
    }
    void grant();
  };

  const removeRole = async (roleRowId: string) => {
    setRemovingId(roleRowId);
    try {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleRowId);
      if (error) throw error;

      setRows((prev) => prev.filter((r) => r.id !== roleRowId));
      toast.success("Role revoked");
    } catch (err) {
      console.error("Error revoking role:", err);
      // The message matters here: the database refuses to let anyone remove
      // their own admin row or the last one, and "Failed to revoke role" alone
      // would read as a bug rather than as the guard doing its job.
      toast.error("Failed to revoke role", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRemovingId(null);
    }
  };

  const removePending = async (pendingId: string) => {
    setRemovingId(pendingId);
    try {
      const { error } = await supabase.rpc("admin_revoke_pending_role", { _id: pendingId });
      if (error) throw error;

      setPending((prev) => prev.filter((r) => r.id !== pendingId));
      toast.success("Invitation cancelled");
    } catch (err) {
      console.error("Error cancelling pending role grant:", err);
      toast.error("Failed to cancel invitation");
    } finally {
      setRemovingId(null);
    }
  };

  /**
   * Granting a role sends no email, so the link is the whole handoff: copy the
   * message and send it however you already talk to that person.
   */
  const copyInvite = async (role: ManagedRole, email: string | null) => {
    const message = roleInviteMessage(role, email ?? "your email", window.location.origin);
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Access link copied", { description: "Paste it to them directly." });
    } catch {
      // Clipboard is blocked in some embedded contexts; show the text so it can
      // still be selected by hand rather than failing silently.
      toast.info(message);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only admins can manage role access.
      </div>
    );
  }

  const visibleRows = filterRole === "all" ? rows : rows.filter((row) => row.role === filterRole);
  const visiblePending =
    filterRole === "all" ? pending : pending.filter((row) => row.role === filterRole);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-primary/10 p-2">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Role Access Management</h1>
          <p className="text-sm text-muted-foreground">
            Grant and revoke admin, transcriber, beta tester, Bible reader, content reviewer
            and complimentary (free All-In) roles. Enter an email address: if it has no
            account yet, the role is saved and applied automatically when that address
            signs up. No email is sent — use the link button on each row to copy an
            access link and send it to them yourself.
          </p>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
        <Input
          placeholder="User email or UUID"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRole()}
        />
        <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as ManagedRole)}>
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {MANAGED_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={addRole} disabled={adding || !identifier.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1">Add</span>
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant full admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              {identifier.trim()} will get the whole console, including this page — they
              will be able to grant and revoke roles, including yours. Only the last
              remaining admin cannot be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                void grant();
              }}
            >
              Grant admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="w-[220px]">
        <Select value={filterRole} onValueChange={(value) => setFilterRole(value as ManagedRole | "all")}>
          <SelectTrigger>
            <SelectValue placeholder="Filter role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All managed roles</SelectItem>
            {MANAGED_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No matching role assignments.</p>
          <p className="text-xs mt-1">Add users above to grant access.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>User ID</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant={isElevatedRole(row.role) ? "default" : "outline"}>
                    {ROLE_LABELS[row.role]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{row.email ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(row.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Copy access link for ${row.email ?? row.user_id}`}
                    onClick={() => copyInvite(row.role, row.email)}
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Revoke ${ROLE_LABELS[row.role]} from ${row.email ?? row.user_id}`}
                    disabled={removingId === row.id || (row.role === "admin" && row.user_id === user?.id)}
                    onClick={() => removeRole(row.id)}
                  >
                    {removingId === row.id ? (
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

      {visiblePending.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MailQuestion className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Waiting on signup</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            These addresses have no account yet. The role is applied the first time someone
            signs up with the address, so cancel any that were typed wrong — a mistyped
            address sits here until someone happens to register it.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePending.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABELS[row.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{row.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Copy signup link for ${row.email}`}
                      onClick={() => copyInvite(row.role, row.email)}
                    >
                      <Link2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Cancel ${ROLE_LABELS[row.role]} invitation for ${row.email}`}
                      disabled={removingId === row.id}
                      onClick={() => removePending(row.id)}
                    >
                      {removingId === row.id ? (
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
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        You cannot revoke your own admin role, and the last remaining admin cannot be
        removed — both are enforced by the database, not just hidden here.
      </p>
    </div>
  );
};

export default BibleAccess;
