import { Construction } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 text-muted-foreground">
      <div className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border-subtle)" }}>
        <Construction className="h-6 w-6" style={{ color: "var(--orbit-text-muted)" }} />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
          {title}
        </h2>
        <p className="text-sm max-w-xs" style={{ color: "var(--orbit-text-secondary)" }}>
          {description ?? "This module is being built. Check back soon."}
        </p>
      </div>
    </div>
  );
}
