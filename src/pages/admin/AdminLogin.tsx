import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { SaduMark } from '@/components/brand/SaduMark';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/**
 * Sign-in only. There was a sign-up mode here that called
 * `supabase.auth.signUp` with no invite code — an open registration form on
 * the admin panel, around the closed-beta gate `/auth` applies. Staff accounts
 * come from an admin granting a role to an invited user, or from
 * `/admin/id-logins`.
 */
const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, role, loading, signIn, signOut } = useAdminAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Someone already signed in with a staff role has nothing to do here. Only
  // staff: AdminLayout sends a signed-in account with no role back to this
  // page, so redirecting every signed-in visitor would bounce between the two.
  useEffect(() => {
    if (!loading && user && role) navigate('/admin', { replace: true });
  }, [loading, user, role, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: result.error.errors[0].message,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message.includes('Invalid login')) {
          toast({
            variant: 'destructive',
            title: 'Invalid credentials',
            description: 'Please check your email and password.',
          });
        } else {
          throw error;
        }
      } else {
        navigate('/admin');
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'An unexpected error occurred',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || (user && role)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Signed in, but not as staff: offering to sign in again read as if the
  // first sign-in had failed.
  if (user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <SaduMark title="Hikaya" variant="clear" className="h-14 w-14 mx-auto mb-4" />
            <CardTitle className="text-2xl font-bold">Admin Panel</CardTitle>
            <CardDescription>
              You're signed in as {user.email ?? 'this account'}, which has no access to the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={() => signOut()}>
              Sign in with a different account
            </Button>
            <Button variant="outline" className="w-full text-muted-foreground" onClick={() => navigate('/')}>
              ← Back to Hikaya
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <SaduMark title="Hikaya" variant="clear" className="h-14 w-14 mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold">Admin Panel</CardTitle>
          <CardDescription>Sign in to manage content</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* The other door. A reviewer who was sent an ID number instead of an
              invitation has no email to type here, and would otherwise be stuck
              on this screen looking for one. */}
          <div className="mt-4 text-center">
            <Button
              variant="link"
              onClick={() => navigate('/login/id')}
              disabled={isSubmitting}
              className="text-muted-foreground"
            >
              Given an ID number instead? Sign in with that
            </Button>
          </div>

          <div className="mt-6 text-center">
            <Button
              variant="outline"
              onClick={() => navigate('/')}
              className="text-muted-foreground"
            >
              ← Back to Hikaya
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminLogin;
