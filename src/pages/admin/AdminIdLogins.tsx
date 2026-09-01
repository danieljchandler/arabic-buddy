import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Copy, KeyRound, Loader2, Plus, Power, PowerOff } from "lucide-react";
import { ROLE_LABELS, type ManagedRole } from "@/lib/rbac";
import {
  ACCESS_ID_ROLES,
  accessIdLoginUrl,
  credentialMessage,
  formatAccessId,
  type AccessIdRole,
} from "../../../supabase/functions/_shared/accessCodeCore";

/**
 * ID logins — the way in for a reviewer an email invitation never reaches.
 *
 * The role console next door grants a role to an address and waits for that
 * address to sign up. When the person on the other end has no inbox they read,
 * that wait never ends: the invitation sits in `pending_role_grants` and the
 * reviewer never arrives. Here an admin mints an ID number and a password
 * instead and sends both over a channel that already works.
 *
 * The page reads the registry directly (RLS admits admins and nobody else) and
 * writes nothing: every change goes through the `access-credentials` edge
 * function under the service role, because creating an account, setting its
 * password and granting it a role are all privileges no browser session should
 * hold.
 *
 * The password is shown exactly once, when it is minted. Nothing stores it in a
 * readable form — not this page, not the registry — so the panel below stays on
 * screen until it is dismissed, and losing it means minting a new one.
 */

interface CredentialRow {
  id: string;
  access_id: string;
  role: ManagedRole;
  label: string | null;
  created_at: string;
  password_set_at: string;
  disabled_at: string | null;
}

/** A credential in the only state it is ever readable in: just minted. */
interface FreshCredential {
  accessId: string;
  password: string;
  role: AccessIdRole;
  /** A reset keeps the ID and changes only the password. */
  isReset: boolean;
}

const AdminIdLogins = () => {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AccessIdRole>("transcriber");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshCredential | null>(null);

  const origin = typeof window === "undefined" ? "https://hakiya.app" : window.location.origin;

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("access_credentials")
        .select("id, access_id, role, label, created_at, password_set_at, disabled_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as CredentialRow[]);
    } catch (err) {
      console.error("Error loading ID logins:", err);
      toast.error("Failed to load ID logins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  /** One place for the three calls, since they differ only in the body. */
  const callFunction = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("access-credentials", { body });
    if (error) throw error;
    const result = (data ?? {}) as { error?: string } & Record<string, unknown>;
    // The function answers a refusal with a 4xx *and* a reason; supabase-js
    // surfaces the status as an error but drops the body, so a plain rethrow
    // would lose the only sentence worth reading.
    if (result.error) throw new Error(result.error);
    return result;
  };

  const create = async () => {
    setCreating(true);
    try {
      const result = await callFunction({ action: "create", role, label: label.trim() });
      setFresh({
        accessId: String(result.access_id ?? ""),
        password: String(result.password ?? ""),
        role,
        isReset: false,
      });
      setLabel("");
      await fetchRows();
    } catch (err) {
      console.error("Error creating ID login:", err);
      toast.error("Could not create the ID login", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (row: CredentialRow) => {
    setBusyId(row.id);
    try {
      const result = await callFunction({ action: "reset_password", credential_id: row.id });
      setFresh({
        accessId: String(result.access_id ?? row.access_id),
        password: String(result.password ?? ""),
        role: row.role as AccessIdRole,
        isReset: true,
      });
      await fetchRows();
    } catch (err) {
      console.error("Error resetting password:", err);
      toast.error("Could not reset the password", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const setDisabled = async (row: CredentialRow, disabled: boolean) => {
    setBusyId(row.id);
    try {
      await callFunction({ action: "set_disabled", credential_id: row.id, disabled });
      toast.success(disabled ? "Access switched off" : "Access switched back on");
      await fetchRows();
    } catch (err) {
      console.error("Error changing access:", err);
      toast.error("Could not change access", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      // Clipboard access is denied often enough (insecure origin, permissions,
      // an in-app browser) that a silent failure would look like a copy that
      // worked — and the credential is unrecoverable once this panel closes.
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };

  const message = fresh
    ? credentialMessage({
        accessId: fresh.accessId,
        password: fresh.password,
        origin,
        roleLabel: fresh.role === "transcriber" ? "transcript reviewer" : "content reviewer",
      })
    : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ID logins</h1>
        <p className="text-muted-foreground mt-1">
          For a reviewer with no email address to invite. Give them an ID number and a password;
          they sign in at{" "}
          <span className="font-mono text-foreground">{accessIdLoginUrl(origin)}</span>.
        </p>
      </div>

      {fresh && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-lg">
              {fresh.isReset ? "New password" : "New ID login"} — copy it now
            </CardTitle>
            <CardDescription>
              This password is shown once and is not stored anywhere. If you lose it, reset it to
              get a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">ID number</Label>
                <p className="font-mono text-xl" data-testid="fresh-access-id">
                  {formatAccessId(fresh.accessId)}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Password</Label>
                <p className="font-mono text-xl" data-testid="fresh-password">
                  {fresh.password}
                </p>
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{message}</pre>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copy(message, "Message")}>
                <Copy className="h-4 w-4 mr-2" />
                Copy the whole message
              </Button>
              <Button variant="outline" onClick={() => copy(fresh.password, "Password")}>
                <Copy className="h-4 w-4 mr-2" />
                Copy password only
              </Button>
              <Button variant="ghost" onClick={() => setFresh(null)}>
                I've sent it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create an ID login</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="id-login-label">Who is this for?</Label>
              <Input
                id="id-login-label"
                placeholder="Ahmed — Yemeni reviewer"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="id-login-role">Role</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as AccessIdRole)}
                disabled={creating}
              >
                <SelectTrigger id="id-login-role" className="sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_ID_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABELS[option as ManagedRole]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            An ID login carries one role and no email address, so it can never reset its own
            password or reach billing. Admin access is granted by email only.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Existing ID logins</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-4">
              No ID logins yet. Create one above and send the details to your reviewer.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID number</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono">{formatAccessId(row.access_id)}</TableCell>
                    <TableCell>{row.label ?? "—"}</TableCell>
                    <TableCell>{ROLE_LABELS[row.role] ?? row.role}</TableCell>
                    <TableCell>
                      {row.disabled_at ? (
                        <Badge variant="outline">Switched off</Badge>
                      ) : (
                        <Badge>Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetPassword(row)}
                        disabled={busyId === row.id}
                      >
                        <KeyRound className="h-4 w-4 mr-1" />
                        New password
                      </Button>
                      {row.disabled_at ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDisabled(row, false)}
                          disabled={busyId === row.id}
                        >
                          <Power className="h-4 w-4 mr-1" />
                          Switch on
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDisabled(row, true)}
                          disabled={busyId === row.id}
                        >
                          <PowerOff className="h-4 w-4 mr-1" />
                          Switch off
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminIdLogins;
