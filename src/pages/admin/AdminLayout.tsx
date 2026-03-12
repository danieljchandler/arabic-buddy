import { useEffect } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TranscriptionStatusBanner } from '@/components/admin/TranscriptionStatusBanner';

const AdminLayout = () => {
  const navigate = useNavigate();
  const { user, isAdmin, isRecorder, loading } = useAdminAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate('/admin/login');
      } else if (!isAdmin && !isRecorder) {
        toast({
          variant: 'destructive',
          title: 'Access Denied',
          description: 'You need admin or recorder privileges to access this area.',
        });
        navigate('/admin/login');
      }
    }
  }, [user, isAdmin, isRecorder, loading, navigate, toast]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // While the navigation effect fires (user not authorised), show spinner
  // rather than returning null, which causes a white flash.
  if (!user || (!isAdmin && !isRecorder)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Outlet />
      <TranscriptionStatusBanner />
    </>
  );
};

export default AdminLayout;
