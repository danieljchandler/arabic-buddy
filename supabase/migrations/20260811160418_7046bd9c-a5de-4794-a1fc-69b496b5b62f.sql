CREATE TABLE IF NOT EXISTS public.saved_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL,
  title text NOT NULL,
  seed jsonb,
  page_context jsonb,
  messages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_chat_conversations_user
  ON public.saved_chat_conversations (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_chat_conversations TO authenticated;
GRANT ALL ON public.saved_chat_conversations TO service_role;

ALTER TABLE public.saved_chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own saved conversations" ON public.saved_chat_conversations;
CREATE POLICY "Users can view their own saved conversations"
  ON public.saved_chat_conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own saved conversations" ON public.saved_chat_conversations;
CREATE POLICY "Users can create their own saved conversations"
  ON public.saved_chat_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own saved conversations" ON public.saved_chat_conversations;
CREATE POLICY "Users can update their own saved conversations"
  ON public.saved_chat_conversations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own saved conversations" ON public.saved_chat_conversations;
CREATE POLICY "Users can delete their own saved conversations"
  ON public.saved_chat_conversations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);