-- Full article text extracted from the source page, for feeds that publish only
-- a teaser in the feed itself.
--
-- Written as guarded DO blocks because `ALTER TABLE ... ADD COLUMN` has no
-- IF NOT EXISTS form in Postgres. The migration runner records completed files,
-- but a partially-applied migration is replayed from the top on the next run,
-- so every statement here must tolerate already-existing state.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'extracted_content'
  ) THEN
    ALTER TABLE "articles" ADD COLUMN "extracted_content" text;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'extracted_at'
  ) THEN
    ALTER TABLE "articles" ADD COLUMN "extracted_at" timestamp with time zone;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'extraction_error'
  ) THEN
    ALTER TABLE "articles" ADD COLUMN "extraction_error" text;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'extracted_byline'
  ) THEN
    ALTER TABLE "articles" ADD COLUMN "extracted_byline" text;
  END IF;
END;
$$;
