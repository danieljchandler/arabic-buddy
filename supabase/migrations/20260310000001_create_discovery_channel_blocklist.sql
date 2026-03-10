-- Tracks YouTube channels rejected by the admin so future fetches skip them automatically.
-- rejection_count increments each time a video from the channel is rejected.
CREATE TABLE discovery_channel_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL UNIQUE,
  channel_name text,
  rejection_count integer NOT NULL DEFAULT 1,
  sample_title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE discovery_channel_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage blocklist"
ON discovery_channel_blocklist
USING (is_admin())
WITH CHECK (is_admin());

CREATE TRIGGER update_discovery_channel_blocklist_updated_at
BEFORE UPDATE ON discovery_channel_blocklist
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
