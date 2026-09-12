-- Ask AI conversation history.
--
-- Written as the opt-in exception to an otherwise ephemeral chat: a learner who
-- wanted to keep a good explanation tapped "Save conversation". It is now the
-- history — the client writes each completed turn as it lands, so a
-- conversation survives the panel being closed, the page being left, and a
-- reload, and is picked back up from the panel's History list or /saved-chats.
-- (The table keeps its name; renaming it would take a migration this project
-- cannot apply from a branch. See CLAUDE.md on why.)
--
-- One row per conversation, updated in place per turn — not a row per turn.
--
-- Messages are stored as one jsonb array rather than a row per message: a
-- saved chat is re-read whole and never queried by individual message, and an
-- update on re-save replaces the array in place.

CREATE TABLE public.saved_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL,
  -- First user message, truncated client-side; renameable from the list page.
  title text NOT NULL,
  -- The sentence the chat was opened about, when there was one: {arabic, english}.
  seed jsonb,
  -- Snapshot of where the chat happened: {route, title}.
  page_context jsonb,
  -- [{role: "user" | "assistant", content: text}]
  messages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_chat_conversations_user
  ON public.saved_chat_conversations (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_chat_conversations TO authenticated;
GRANT ALL ON public.saved_chat_conversations TO service_role;

ALTER TABLE public.saved_chat_conversations ENABLE ROW LEVEL SECURITY;

-- Owner-only throughout: a conversation can quote anything the learner was
-- reading or asking, so it is theirs alone.
CREATE POLICY "Users can view their own saved conversations"
  ON public.saved_chat_conversations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved conversations"
  ON public.saved_chat_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved conversations"
  ON public.saved_chat_conversations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved conversations"
  ON public.saved_chat_conversations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
