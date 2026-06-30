-- Four constraint kinds Prisma's schema language cannot express, written by
-- hand. This is why `prisma db push` is banned in this repository: push
-- reconciles the database to the schema file and would silently drop every one
-- of them.

-- ---------------------------------------------------------------------------
-- 1. Partial unique index: exactly one current slug per recipe.
--
-- A plain UNIQUE on (recipe_id) would allow only one slug per recipe ever,
-- which defeats the point of keeping history. The predicate restricts the
-- constraint to the live row, leaving any number of superseded ones.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ux_recipe_slug_current"
  ON "recipe_slugs" ("recipe_id")
  WHERE "is_current";

-- ---------------------------------------------------------------------------
-- 2. Functional unique index: Ada@example.com and ada@example.com are one
--    person.
--
-- The plain @unique on email remains and is case-sensitive; this is the half
-- that makes sign-in behave the way users expect.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ux_users_email_lower"
  ON "users" (lower("email"));

-- ---------------------------------------------------------------------------
-- 3. Deferrable position constraints.
--
-- Reordering swaps two positions inside one transaction, which passes through
-- a state where two rows share a position. A UNIQUE INDEX is checked per
-- statement and rejects that; a UNIQUE CONSTRAINT declared DEFERRABLE
-- INITIALLY DEFERRED is checked at COMMIT, by which time the swap is complete.
--
-- Only constraints can be deferred, not indexes, so Prisma's generated indexes
-- are dropped and replaced. INITIALLY DEFERRED rather than an explicit
-- SET CONSTRAINTS per transaction: the reorder path is the common case, and a
-- rule that has to be remembered at every call site is a rule that will be
-- forgotten at one of them. The constraint still fires at COMMIT, so a genuine
-- duplicate is still rejected.
-- ---------------------------------------------------------------------------
DROP INDEX "ux_recipe_step_position";
ALTER TABLE "recipe_steps"
  ADD CONSTRAINT "ux_recipe_step_position"
  UNIQUE ("recipe_id", "position") DEFERRABLE INITIALLY DEFERRED;

DROP INDEX "ux_recipe_ingredient_position";
ALTER TABLE "recipe_ingredients"
  ADD CONSTRAINT "ux_recipe_ingredient_position"
  UNIQUE ("recipe_id", "position") DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints: invariants the application must not be able to break.
--
-- The publish one is the important one. It makes "published implies a publish
-- date, and a publish date implies published" a property of the database
-- rather than a convention every code path has to remember, so no route,
-- action or script can produce a half-published recipe.
-- ---------------------------------------------------------------------------
ALTER TABLE "recipes"
  ADD CONSTRAINT "ck_recipes_published_consistent"
  CHECK (("status" = 'PUBLISHED') = ("published_at" IS NOT NULL));

ALTER TABLE "recipes"
  ADD CONSTRAINT "ck_recipes_servings" CHECK ("servings" >= 1);

ALTER TABLE "recipes"
  ADD CONSTRAINT "ck_recipes_prep_minutes" CHECK ("prep_minutes" >= 0);

ALTER TABLE "recipes"
  ADD CONSTRAINT "ck_recipes_cook_minutes" CHECK ("cook_minutes" >= 0);

ALTER TABLE "recipe_steps"
  ADD CONSTRAINT "ck_recipe_step_position" CHECK ("position" >= 0);

ALTER TABLE "recipe_ingredients"
  ADD CONSTRAINT "ck_recipe_ingredient_position" CHECK ("position" >= 0);
