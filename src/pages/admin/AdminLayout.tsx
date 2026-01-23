import { useEffect } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const AdminLayout = () => {
  const navigate = useNavigate();
  const { user, isAdmin, loading } = useAdminAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate('/admin/login');
      } else if (!isAdmin) {
        toast({
          variant: 'destructive',
          title: 'Access Denied',
          description: 'You need admin privileges to access this area.',
        });
        navigate('/admin/login');
      }
    }
  }, [user, isAdmin, loading, navigate, toast]);

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

  if (!user || !isAdmin) {
    return null;
  }

  return <Outlet />;
};

export default AdminLayout;
