import { Sparkles } from "lucide-react";

export default function ConstellationPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 select-none">
      <div className="relative flex items-center justify-center h-24 w-24">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-cyan-400/10 blur-xl" />
        <div className="relative flex items-center justify-center h-20 w-20 rounded-full bg-gradient-to-br from-violet-500/15 via-indigo-500/10 to-cyan-400/10 border border-violet-500/20">
          <Sparkles className="h-9 w-9 text-violet-400" />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Constellation</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          The ITSM platform that ties into O.R.B.I.T. — incident workflows, change management, and
          service catalogues unified in one place.
        </p>
      </div>

      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 text-sm font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
        </span>
        Coming soon
      </div>
    </div>
  );
}
