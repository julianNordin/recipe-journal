import { ImageResponse } from "next/og";

import { db } from "@/server/db";
import { findPublishedRecipeBySlug } from "@/server/recipes/queries";

/**
 * The picture that appears when somebody pastes a recipe link somewhere.
 *
 * **It is a public surface and it obeys the same rule as every other one.** The
 * lookup is `findPublishedRecipeBySlug`, scoped to published in its `where`, so
 * an unpublished recipe gets the generic image -- byte for byte the one a slug
 * that never existed gets. That is asserted rather than assumed, and it is the
 * assertion that matters here: a card preview is rendered by somebody else's
 * server, cached by somebody else, and shown to people who never visited the
 * site. A draft title leaking into one is not a 404 anybody can serve.
 *
 * No custom font is loaded. `next/og` renders through Satori, which needs the
 * font data at request time -- a fetch, or a file read that the standalone
 * output has to be told to trace. The built-in is enough for two lines of text
 * and it is one less thing for phase 21's container to get wrong.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Recipe Journal";

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const recipe = await findPublishedRecipeBySlug(db, slug);

  const title = recipe?.title ?? "Recipe Journal";
  const subtitle = recipe?.summary ?? "Recipes, written down properly.";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#faf7f2",
        color: "#1c1917",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 32, color: "#b4491f" }}>
        ◆ Recipe Journal
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 72, lineHeight: 1.1, fontWeight: 700 }}>{title}</div>
        {/* Trimmed, because Satori does not wrap forever and a 400-character
              summary would run off the bottom of the image rather than clip. */}
        <div style={{ fontSize: 32, color: "#6b625a" }}>
          {subtitle.length > 120 ? `${subtitle.slice(0, 117)}…` : subtitle}
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#6b625a" }}>
        {recipe === null ? "" : (recipe.author.name ?? "")}
      </div>
    </div>,
    size,
  );
}
