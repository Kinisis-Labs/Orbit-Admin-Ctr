import { ExternalLink, LayoutGrid, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import type { Application } from "../../services/applications";

interface AppTileProps {
  app: Application;
}

function AppTile({ app }: AppTileProps) {
  const initials = app.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <a
      href={app.url ?? "#"}
      target={app.url ? "_blank" : undefined}
      rel="noopener noreferrer"
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-[var(--orbit-border)] bg-[var(--orbit-bg-card)]",
        "p-5 transition-all duration-200 hover:border-[var(--orbit-primary)] hover:bg-[var(--orbit-bg-card-hover)]",
        "hover:shadow-[0_0_0_1px_var(--orbit-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orbit-primary)]",
        !app.url && "cursor-default",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--orbit-primary)] to-[var(--orbit-accent)] text-sm font-bold text-white">
          {app.logoUrl ? (
            <img src={app.logoUrl} alt={app.displayName} className="h-8 w-8 rounded object-contain" />
          ) : (
            initials
          )}
        </div>
        {app.url && (
          <ExternalLink className="h-4 w-4 text-[var(--orbit-text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--orbit-text-primary)]">{app.displayName}</p>
        {app.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--orbit-text-muted)]">
            {app.description}
          </p>
        )}
      </div>
      {app.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {app.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--orbit-border)] px-2 py-0.5 text-[10px] text-[var(--orbit-text-secondary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}

interface AppLauncherProps {
  apps: Application[];
  isLoading: boolean;
  error?: Error | null;
}

export function AppLauncher({ apps, isLoading, error }: AppLauncherProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[var(--orbit-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading applications…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--orbit-danger)]/30 bg-[var(--orbit-danger)]/10 p-4 text-sm text-[var(--orbit-danger)]">
        Failed to load applications: {error.message}
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-[var(--orbit-text-muted)]">
        <LayoutGrid className="h-10 w-10 opacity-30" />
        <p className="text-sm">No applications available for your account.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {apps.map((app) => (
        <AppTile key={app.id} app={app} />
      ))}
    </div>
  );
}
