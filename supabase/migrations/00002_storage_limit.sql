-- Storage limit: 100MB per user on total project file content
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)

CREATE OR REPLACE FUNCTION get_user_storage_bytes()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(SUM(LENGTH(pf.content)), 0)::bigint
  FROM project_files pf
  JOIN projects p ON p.id = pf.project_id
  WHERE p.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION check_storage_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_bytes bigint;
  new_bytes bigint;
  max_bytes bigint := 104857600; -- 100MB
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(LENGTH(pf.content)), 0)::bigint
    INTO total_bytes
    FROM project_files pf
    JOIN projects p ON p.id = pf.project_id
    WHERE p.user_id = auth.uid()
      AND pf.id != NEW.id;
  ELSE
    SELECT COALESCE(SUM(LENGTH(pf.content)), 0)::bigint
    INTO total_bytes
    FROM project_files pf
    JOIN projects p ON p.id = pf.project_id
    WHERE p.user_id = auth.uid();
  END IF;

  new_bytes := LENGTH(NEW.content);

  IF total_bytes + new_bytes > max_bytes THEN
    RAISE EXCEPTION 'Storage limit of 100MB exceeded. Please delete some files and try again.'
      USING HINT = 'Current usage: ' || total_bytes || ' bytes, trying to add: ' || new_bytes || ' bytes';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_storage_limit
  BEFORE INSERT OR UPDATE ON project_files
  FOR EACH ROW
  EXECUTE FUNCTION check_storage_limit();
