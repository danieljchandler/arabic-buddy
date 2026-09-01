import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { SaduMark } from "@/components/brand/SaduMark";
import {
  accessIdToEmail,
  formatAccessId,
  isAccessId,
  normalizeAccessId,
} from "../../supabase/functions/_shared/accessCodeCore";

/**
 * Signing in with an ID number instead of an email address.
 *
 * For a native-speaker reviewer who has no inbox to receive an invitation in.
 * An admin mints the ID and the password on `/admin/id-logins` and sends both
 * over a channel that already reaches them; this page is the other end of that
 * message, and it is the only address they ever need.
 *
 * Almost nothing happens here. The ID maps onto the account's real address by
 * the shared rule in `accessCodeCore`, and the sign-in below it is the ordinary
 * password sign-in every other account uses — which is the point: no second
 * session mechanism, no second set of role checks, nothing else in the app
 * needs to know this page exists.
 */
const IdLogin = () => {
  const [accessId, setAccessId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signIn } = useAdminAuth();
  const navigate = useNavigate();

  const digits = normalizeAccessId(accessId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Checked here rather than left to the server: an ID that is the wrong
    // length cannot match any account, and "invalid login credentials" would
    // send someone hunting for a password problem they do not have.
    if (!isAccessId(digits)) {
      setError("An ID number is 8 digits. Check the number you were sent.");
      return;
    }
    if (password.length === 0) {
      setError("Enter the password you were sent.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: signInError } = await signIn(accessIdToEmail(digits), password.trim());
      if (signInError) {
        // Deliberately one message for both halves. Saying which of the two was
        // wrong tells anyone trying IDs at random which ones exist.
        setError(
          "That ID number and password did not match. Check them, or ask for a new password.",
        );
        return;
      }
      // Straight to the work. The layout sends anyone whose role does not reach
      // this page onward, so there is no need to branch on the role here.
      navigate("/admin/videos", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <SaduMark title="Hakiya" variant="clear" className="h-14 w-14 mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold">Sign in with your ID</CardTitle>
          <CardDescription>
            Use the ID number and password you were sent. No email address needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="access-id">ID number</Label>
              <Input
                id="access-id"
                // `inputMode` rather than `type="number"`: a numeric keypad on a
                // phone, without the spinner, the scroll-wheel edits, or a
                // browser silently reformatting the value.
                inputMode="numeric"
                autoComplete="username"
                placeholder="1234 5678"
                value={accessId}
                onChange={(event) => setAccessId(event.target.value)}
                // A pasted ID keeps whatever spacing it was sent with, so the
                // field shows it back grouped rather than rejecting it.
                onBlur={() => setAccessId(digits ? formatAccessId(digits) : accessId)}
                required
                disabled={isSubmitting}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="access-password">Password</Label>
              <div className="relative">
                <Input
                  id="access-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="XXXX-XXXX-XXXX"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={isSubmitting}
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Lost your password? It cannot be emailed to you — ask for a new one.
          </p>

          <div className="mt-4 text-center">
            <Button
              variant="link"
              onClick={() => navigate("/admin/login")}
              className="text-muted-foreground"
            >
              Sign in with an email address instead
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default IdLogin;
