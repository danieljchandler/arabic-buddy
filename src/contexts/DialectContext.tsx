import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export type DialectModule = 'Gulf' | 'Egyptian' | 'Yemeni';

interface DialectContextType {
  activeDialect: DialectModule;
  setDialect: (dialect: DialectModule) => void;
}

const DialectContext = createContext<DialectContextType>({
  activeDialect: 'Gulf',
  setDialect: () => {},
});

const STORAGE_KEY = 'hakiya_dialect_module';

/** Query-key prefixes that depend on the active dialect and should be
 *  invalidated when the user switches dialect. */
const DIALECT_DEPENDENT_KEYS = [
  'due-words',
  'review-stats',
  'all-vocabulary-words',
  'user-vocabulary',
  'topics',
  'lessons',
  'smart-notifications',
];

/** Per-dialect accent palette (HSL triplets, matches index.css token format).
 *  These override --primary / --accent / --ring at runtime so all primary-themed
 *  UI (buttons, focus rings, badges, links) reflects the active dialect. */
const DIALECT_THEMES: Record<DialectModule, { primary: string; ring: string; glow: string }> = {
  // Gulf — teal
  Gulf:     { primary: '180 65% 32%', ring: '180 65% 32%', glow: '180 70% 45%' },
  // Egyptian — amber / gold
  Egyptian: { primary: '38 85% 45%',  ring: '38 85% 45%',  glow: '42 95% 55%'  },
  // Yemeni — deep red
  Yemeni:   { primary: '0 70% 42%',   ring: '0 70% 42%',   glow: '0 75% 55%'   },
};

function applyDialectTheme(dialect: DialectModule) {
  if (typeof document === 'undefined') return;
  const theme = DIALECT_THEMES[dialect];
  const root = document.documentElement;
  try {
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--accent', theme.primary);
    root.style.setProperty('--ring', theme.ring);
    root.style.setProperty('--primary-glow', theme.glow);
    root.dataset.dialect = dialect.toLowerCase();
  } catch {
    // ignore (SSR / restricted iframe)
  }
}

export const DialectProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [activeDialect, setActiveDialect] = useState<DialectModule>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return (stored === 'Gulf' || stored === 'Egyptian' || stored === 'Yemeni') ? stored : 'Gulf';
    } catch {
      return 'Gulf';
    }
  });

  // On mount, sync from profile if authenticated
  useEffect(() => {
    const syncFromProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles' as never)
        .select('preferred_dialect')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const dialect = (data as Record<string, unknown>).preferred_dialect;
        if (dialect === 'Gulf' || dialect === 'Egyptian' || dialect === 'Yemeni') {
          setActiveDialect(dialect);
          try { localStorage.setItem(STORAGE_KEY, dialect); } catch {}
        }
      }
    };
    syncFromProfile();
  }, []);

  // Apply theme tokens whenever the active dialect changes (and on mount).
  useEffect(() => {
    applyDialectTheme(activeDialect);
  }, [activeDialect]);

  const setDialect = (dialect: DialectModule) => {
    setActiveDialect(dialect);
    try { localStorage.setItem(STORAGE_KEY, dialect); } catch {}

    // Invalidate only dialect-dependent queries instead of the entire cache
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && DIALECT_DEPENDENT_KEYS.includes(key);
      },
    });

    // Persist to profile if authenticated — with error handling
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles' as never)
          .update({ preferred_dialect: dialect } as never)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) {
              console.error('Failed to persist dialect preference:', error);
              toast.error('Could not save dialect preference');
            }
          });
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
