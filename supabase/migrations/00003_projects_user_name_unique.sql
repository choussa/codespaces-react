-- Enforce per-user unique project names.
--
-- Rollback notes:
--   1) DROP INDEX IF EXISTS projects_user_id_name_unique_idx;
--   2) If needed, restore duplicate rows from backups.

-- Remove duplicate rows (keep most recently updated, then newest id).
WITH ranked_projects AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, name
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM projects
)
DELETE FROM projects p
USING ranked_projects r
WHERE p.id = r.id
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS projects_user_id_name_unique_idx
  ON projects (user_id, name);
