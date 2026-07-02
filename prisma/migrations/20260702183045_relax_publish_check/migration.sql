-- Relax the publish CHECK from a biconditional to one direction.
--
-- The previous constraint was:
--
--   CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
--
-- which forbids a draft from carrying a publish date. Writing the publish rule
-- showed that this forbids a state the application actually wants.
--
-- Publishing sets published_at once and never moves it, so that a recipe which
-- is unpublished to fix a typo and then published again keeps its original
-- date instead of jumping to the top of the archive. That requires the date to
-- survive the trip through DRAFT, which the biconditional made impossible: the
-- unpublish would have to null it, and the information would be gone.
--
-- Only one direction was ever load-bearing. A published recipe with no date
-- breaks ordering, feeds and the sitemap. A draft that remembers when it was
-- last public breaks nothing -- it is a record, not an inconsistency.

ALTER TABLE "recipes" DROP CONSTRAINT "ck_recipes_published_consistent";

ALTER TABLE "recipes"
  ADD CONSTRAINT "ck_recipes_published_has_date"
  CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);
