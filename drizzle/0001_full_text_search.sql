-- Full-text search.
--
-- drizzle-kit cannot express `tsvector` columns or GIN indexes, so this part of
-- the schema is hand-written. Guarded with IF NOT EXISTS so re-running is safe.
--
-- The application writes the vector explicitly on every article upsert, using
-- weighted fields:
--     setweight(to_tsvector('english', coalesce(title,'')),   'A')
--  || setweight(to_tsvector('english', coalesce(summary,'')), 'B')
--  || setweight(to_tsvector('english', coalesce(content,'')), 'C')
-- Doing it in the batch INSERT avoids a second round trip per article.
-- The trigger below is a safety net for rows that arrive with a NULL vector.

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

CREATE INDEX IF NOT EXISTS "articles_search_idx"
  ON "articles" USING gin ("search_vector");

CREATE OR REPLACE FUNCTION articles_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.search_vector IS NULL THEN
    NEW.search_vector :=
         setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B')
      || setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS articles_search_vector_trigger ON "articles";

CREATE TRIGGER articles_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "articles"
  FOR EACH ROW
  EXECUTE FUNCTION articles_search_vector_update();
