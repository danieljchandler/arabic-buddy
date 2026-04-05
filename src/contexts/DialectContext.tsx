import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

export type DialectModule = 'Gulf' | 'Egyptian' | 'Yemeni';

interface DialectContextType {
  activeDialect: DialectModule;
  setDialect: (dialect: DialectModule) => void;
}

const DialectContext = createContext<DialectContextType>({
  activeDialect: 'Gulf',
  setDialect: () => {},
});

const STORAGE_KEY = 'lahja_dialect_module';

export const DialectProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [activeDialect, setActiveDialect] = useState<DialectModule>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored === 'Gulf' || stored === 'Egyptian' || stored === 'Yemeni') ? stored : 'Gulf';
  });

  // On mount, sync from profile if authenticated
  useEffect(() => {
    const syncFromProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles' as any)
        .select('preferred_dialect')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const dialect = (data as any).preferred_dialect;
        if (dialect === 'Gulf' || dialect === 'Egyptian') {
          setActiveDialect(dialect);
          localStorage.setItem(STORAGE_KEY, dialect);
        }
      }
    };
    syncFromProfile();
  }, []);

  const setDialect = (dialect: DialectModule) => {
    setActiveDialect(dialect);
    localStorage.setItem(STORAGE_KEY, dialect);

    // Invalidate all queries so they refetch with new dialect
    queryClient.invalidateQueries();

    // Persist to profile if authenticated
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles' as any)
          .update({ preferred_dialect: dialect } as any)
          .eq('user_id', user.id)
          .then(() => {});
      }
    });
  };

  return (
    <DialectContext.Provider value={{ activeDialect, setDialect }}>
      {children}
    </DialectContext.Provider>
  );
};

export const useDialect = () => useContext(DialectContext);
