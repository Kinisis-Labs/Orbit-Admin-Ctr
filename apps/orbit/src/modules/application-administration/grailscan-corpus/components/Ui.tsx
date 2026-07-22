import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { CorpusApiError } from "../api/client";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--orbit-border)] bg-[var(--orbit-bg-card)] ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const tone = /failed|rejected|danger|revoked/.test(value)
    ? "text-red-300 bg-red-500/10 border-red-500/30"
    : /completed|approved|healthy|acceptable/.test(value)
      ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
      : /processing|pending|uploading|warning/.test(value)
        ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
        : "text-sky-300 bg-sky-500/10 border-sky-500/30";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function LoadingState({ label = "Loading Golden Corpus data…" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-[var(--orbit-text-muted)]">{label}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const apiError = error instanceof CorpusApiError ? error : null;
  return (
    <Panel className="p-5 border-red-500/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-200">
            {apiError?.message ?? "Golden Corpus request failed"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--orbit-text-muted)]">
            {apiError?.code ?? "unexpected_error"}
          </p>
          {apiError?.correlationId && (
            <p className="mt-2 text-xs text-[var(--orbit-text-secondary)]">
              Correlation ID: <span className="font-mono">{apiError.correlationId}</span>
            </p>
          )}
        </div>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1 rounded-lg border border-[var(--orbit-border)] px-2.5 py-1.5 text-xs"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    </Panel>
  );
}
