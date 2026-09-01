/**
 * access-credentials — minting, resetting and switching off ID-number logins.
 *
 * The email invitation in the role console assumes the recipient has an inbox
 * they read and will complete a signup in. For the native speakers this app
 * depends on that assumption fails often enough to have cost real reviewers:
 * the role is granted, the invitation waits in `pending_role_grants`, and
 * nobody arrives. So an admin can instead mint an ID number and a password and
 * send both over a channel that already works.
 *
 * Everything here runs under the service role because everything here is a
 * privilege the holder must not have: creating an auth account, setting its
 * password, and writing the `user_roles` row that makes it a reviewer. A client
 * that could do any of those could make itself staff.
 *
 * Three actions, all admin-only:
 *
 *   create          — new account, ID, password and role grant. Returns the
 *                     password ONCE; it is never stored anywhere readable.
 *   reset_password  — mint a new password for an existing ID. The only
 *                     recovery path there is: these accounts have no inbox.
 *   set_disabled    — switch access off (or back on). Bans the account *and*
 *                     removes the role, because either alone is a half-measure.
 *
 * Body: { action, role?, label?, credential_id?, disabled? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/requireRole.ts";
import {
  accessIdToEmail,
  generateAccessId,
  generatePassword,
  isAccessIdRole,
} from "../_shared/accessCodeCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * A hundred years. Supabase has no "disabled" flag — a ban with a long duration
 * is how an account is refused a session, and `none` is how that is lifted.
 */
const BAN_FOREVER = "876000h";

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * How many IDs to try before giving up.
 *
 * Eight digits against a handful of reviewers means a collision is vanishingly
 * unlikely, but "vanishingly unlikely" is not "impossible" and the failure —
 * a unique-violation surfacing as a 500 — would be baffling. Three draws costs
 * nothing and removes the question.
 */
const ID_ATTEMPTS = 3;

interface CredentialRow {
  id: string;
  user_id: string;
  access_id: string;
  role: string;
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // Admin only, with the service-role bypass the rest of the pipeline uses.
  const gate = await requireAdmin(req, cors);
  if (gate.denied) return gate.response;

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);

    const action = String(body.action ?? "");

    if (action === "create") return await create(body, gate.userId, json);
    if (action === "reset_password") return await resetPassword(body, json);
    if (action === "set_disabled") return await setDisabled(body, json);

    return json({ error: `Unknown action: ${action || "(none)"}` }, 400);
  } catch (error) {
    console.error("access-credentials failed:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

/** Look up a credential by its row id, or say plainly that it is not there. */
async function loadCredential(id: unknown): Promise<CredentialRow | null> {
  if (typeof id !== "string" || id.length === 0) return null;

  const { data } = await admin()
    .from("access_credentials")
    .select("id, user_id, access_id, role")
    .eq("id", id)
    .maybeSingle();

  const row = data as Partial<CredentialRow> | null;
  if (!row?.id || !row.user_id || !row.access_id || !row.role) return null;
  return row as CredentialRow;
}

type Json = (body: unknown, status?: number) => Response;

/**
 * Mint an account, its role and its first password.
 *
 * Ordered so that a failure never leaves a usable half: the auth account is
 * created first, and if either the registry row or the role grant fails after
 * it, the account is deleted again. The alternative — an orphaned auth user
 * with a password someone has been sent and no role behind it — is an account
 * that can sign in and see nothing, which reads to its holder as the app being
 * broken.
 */
async function create(
  body: Record<string, unknown>,
  createdBy: string | null,
  json: Json,
): Promise<Response> {
  const role = String(body.role ?? "");
  if (!isAccessIdRole(role)) {
    return json(
      {
        error:
          `Role ${role || "(none)"} cannot be an ID login. ` +
          `ID logins exist for outside contributors; roles that carry billing ` +
          `or the console are granted by email.`,
      },
      400,
    );
  }

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const label = rawLabel.length > 0 ? rawLabel.slice(0, 120) : null;

  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
    const accessId = generateAccessId();
    const password = generatePassword();

    const { data: created, error: createError } = await admin().auth.admin.createUser({
      email: accessIdToEmail(accessId),
      password,
      // No inbox exists to confirm from, so confirming here is not a shortcut
      // past a check — it is the only way the account is ever usable.
      email_confirm: true,
      user_metadata: { access_id: accessId, label, login_kind: "access_id" },
    });

    const userId = created?.user?.id;
    if (createError || !userId) {
      // A taken address means this ID is already someone's. Any other failure
      // is real and worth reporting rather than retrying blindly.
      const message = createError?.message ?? "The account could not be created";
      if (/already|exists|registered|duplicate/i.test(message)) continue;
      return json({ error: message }, 502);
    }

    const { data: row, error: rowError } = await admin()
      .from("access_credentials")
      .insert({
        access_id: accessId,
        user_id: userId,
        role,
        label,
        created_by: createdBy,
      })
      .select("id, access_id, user_id, role, label, created_at, password_set_at, disabled_at")
      .single();

    if (rowError || !row) {
      await admin().auth.admin.deleteUser(userId);
      if (/duplicate|unique/i.test(rowError?.message ?? "")) continue;
      return json({ error: rowError?.message ?? "The credential could not be recorded" }, 500);
    }

    const { error: roleError } = await admin()
      .from("user_roles")
      .insert({ user_id: userId, role });

    if (roleError) {
      await admin().from("access_credentials").delete().eq("id", (row as CredentialRow).id);
      await admin().auth.admin.deleteUser(userId);
      return json({ error: roleError.message }, 500);
    }

    // The one and only time the password is readable. Nothing stores it.
    return json({ credential: row, access_id: accessId, password });
  }

  return json({ error: "Could not allocate a free ID number. Try again." }, 503);
}

/**
 * A new password for an ID that already exists.
 *
 * Not a "send a reset link" — there is no link to send and no inbox to send it
 * to. Whoever holds the old password loses it the moment this runs, which is
 * also what makes it the way to cut off a credential that leaked into the wrong
 * chat.
 */
async function resetPassword(body: Record<string, unknown>, json: Json): Promise<Response> {
  const credential = await loadCredential(body.credential_id);
  if (!credential) return json({ error: "No such ID login" }, 404);

  const password = generatePassword();
  const { error } = await admin().auth.admin.updateUserById(credential.user_id, { password });
  if (error) return json({ error: error.message }, 502);

  await admin()
    .from("access_credentials")
    .update({ password_set_at: new Date().toISOString() })
    .eq("id", credential.id);

  return json({ access_id: credential.access_id, password });
}

/**
 * Switch a credential off, or back on.
 *
 * Both halves, every time. Banning the account alone leaves the `user_roles`
 * row in place, so the person still reads as a reviewer everywhere the app
 * counts roles; removing the role alone leaves an account that can still sign
 * in and hold a session. Neither on its own is what an admin means by "stop
 * this person".
 *
 * The registry row survives either way. It is the record that this ID existed,
 * and the transcript revisions it signed outlive the access.
 */
async function setDisabled(body: Record<string, unknown>, json: Json): Promise<Response> {
  const credential = await loadCredential(body.credential_id);
  if (!credential) return json({ error: "No such ID login" }, 404);

  const disabled = body.disabled !== false;
  const { role } = credential;

  const { error } = await admin().auth.admin.updateUserById(credential.user_id, {
    ban_duration: disabled ? BAN_FOREVER : "none",
  });
  if (error) return json({ error: error.message }, 502);

  if (disabled) {
    await admin()
      .from("user_roles")
      .delete()
      .eq("user_id", credential.user_id)
      .eq("role", role);
  } else {
    await admin()
      .from("user_roles")
      .upsert({ user_id: credential.user_id, role }, { onConflict: "user_id,role" });
  }

  await admin()
    .from("access_credentials")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", credential.id);

  return json({ ok: true, disabled });
}
