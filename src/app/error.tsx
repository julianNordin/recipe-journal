"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Container, EmptyState } from "@/components/ui/Surfaces";

/**
 * An error boundary must be a Client Component -- it needs state and an event
 * handler to offer the retry.
 *
 * Note what is NOT rendered: error.message. In production React replaces it
 * with a generic string and exposes only a digest, precisely so a server-side
 * message cannot leak to a browser. Rendering it anyway would show something
 * useless in production and something potentially sensitive in development.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container>
      <div style={{ paddingBlock: "var(--space-8)" }}>
        <EmptyState
          title="Something went wrong"
          action={
            <Button onClick={reset} variant="secondary">
              Try again
            </Button>
          }
        >
          {error.digest
            ? `The error was logged with reference ${error.digest}.`
            : "The error has been logged."}
        </EmptyState>
      </div>
    </Container>
  );
}
