import { LinkButton } from "@/components/ui/Button";
import { Container, EmptyState } from "@/components/ui/Surfaces";

/**
 * Rendered for a route that does not match and for any notFound() call.
 *
 * From Phase 14 this page carries real weight: a draft belonging to somebody
 * else is deliberately a 404 rather than a 403, because "this exists but is
 * not yours" tells a stranger that it exists.
 */
export default function NotFound() {
  return (
    <Container>
      <div style={{ paddingBlock: "var(--space-8)" }}>
        <EmptyState
          title="Not found"
          action={
            <LinkButton href="/" variant="secondary">
              Back to the start
            </LinkButton>
          }
        >
          That page does not exist, or it is not published.
        </EmptyState>
      </div>
    </Container>
  );
}
