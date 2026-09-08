-- Existing imports predate snapshot tracking. Require a fresh export before replacing them.
INSERT INTO apple_import_snapshots(user_id,type,exported_at)
SELECT e.user_id,e.type,MAX(c.last_sync)
FROM source_entries e JOIN connections c ON c.user_id=e.user_id AND c.provider='apple-health'
WHERE e.provider='apple-health' AND c.last_sync IS NOT NULL
GROUP BY e.user_id,e.type
ON CONFLICT(user_id,type) DO NOTHING;
