import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Check whether the current user has the `bible_reader` (or `admin`) role,
 * which grants access to the Bible reading feature.
 */
export const useBibleAccess = () => {
  const { user, loading: authLoading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const checkedUserRef = useRef<string | null>(null);

  const checkAccess = useCallback(async (userId: string) => {
    try {
      const [bibleResult, adminResult] = await Promise.all([
        supabase.rpc("has_role", {
          _user_id: userId,
          _role: "bible_reader",
        }),
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ]);

      setHasAccess(bibleResult.data === true || adminResult.data === true);
    } catch (err) {
      console.error("Error checking bible access:", err);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setHasAccess(false);
      setLoading(false);
      return;
    }

    // Avoid re-checking for the same user on token refresh
    if (checkedUserRef.current === user.id) return;
    checkedUserRef.current = user.id;

    setLoading(true);
    checkAccess(user.id);
  }, [user, authLoading, checkAccess]);

  return { hasAccess, loading: authLoading || loading };
};
