-- The feedback-screenshots bucket got its storage.objects policies in
-- 20260629191555/20260629191610 but no migration ever created the bucket
-- itself — production got it from the dashboard, so on a rebuilt environment
-- beta-feedback screenshot upload fails with "Bucket not found". Private, per
-- the read policies (owner + admin only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', false)
ON CONFLICT (id) DO NOTHING;
