import { createRoot } from "react-dom/client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import App from "./App";
import "./styles/globals.css";
import "./lib/appInsights";

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Orbit] Uncaught render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0b1120",
            color: "#e2e8f0",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "#f87171" }}>
              Application error
            </div>
            <pre
              style={{
                fontSize: 12,
                color: "#94a3b8",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                background: "#1e293b",
                padding: 12,
                borderRadius: 6,
                border: "1px solid #334155",
              }}
            >
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
