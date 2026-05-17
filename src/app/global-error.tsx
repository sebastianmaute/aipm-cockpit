"use client";

// Last-resort error boundary. Catches errors that propagate past `error.tsx`
// — i.e. errors thrown by `layout.tsx` itself, or by error.tsx's own render.
// Replaces the root layout when active, so it MUST emit its own <html> and
// <body>; nothing else from the app shell (fonts, globals.css) is guaranteed
// to be loaded.
//
// Reference: node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md
//            (see "Global errors" section, line ~398)

interface GlobalErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#f7f7f8",
          color: "#1f2937",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            maxWidth: "32rem",
            width: "100%",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            background: "#ffffff",
            boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
            textAlign: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
            The app couldn&apos;t start
          </h2>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "#4b5563",
            }}
          >
            A fatal error prevented the application shell from loading. Your
            saved tasks are stored in this browser and are unaffected.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: "0.75rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              borderRadius: "0.375rem",
              border: "none",
              cursor: "pointer",
              background: "#004159",
              color: "#ffffff",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
