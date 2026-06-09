import { LogIn } from "lucide-react";
import { useEffect } from "react";

const LETTERS = [
  { letter: "O", word: "Organizational" },
  { letter: "R", word: "Resource Management" },
  { letter: "B", word: "Business Operations" },
  { letter: "I", word: "Insights" },
  { letter: "T", word: "Telemetry" },
];

export default function SignedOut() {
  useEffect(() => {
    const stored = window.localStorage.getItem("orbit-theme");
    const root = document.documentElement;
    if (stored === "light") {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-end gap-[3px]">
            {LETTERS.map(({ letter }) => (
              <span
                key={letter}
                className="text-5xl font-extrabold tracking-tight text-primary leading-none"
              >
                {letter}
                <span className="text-muted-foreground font-light text-4xl">.</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {LETTERS.map(({ letter, word }, i) => (
              <span key={letter} className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground tracking-widest uppercase">
                  {word}
                </span>
                {i < LETTERS.length - 1 && (
                  <span className="text-border text-[11px]">·</span>
                )}
              </span>
            ))}
          </div>
        </div>

        <div className="w-full border border-border rounded-lg bg-card shadow-lg px-6 py-8 flex flex-col items-center gap-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-1">
              <LogIn className="h-5 w-5 text-muted-foreground" />
            </div>
            <h1 className="text-lg font-semibold">You've been signed out</h1>
            <p className="text-sm text-muted-foreground">
              Your session has ended. Sign back in to access the dashboard.
            </p>
          </div>
          <a
            href="/api/auth/login"
            className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 hover:bg-primary/90 transition-colors"
          >
            <LogIn className="h-4 w-4" />
            Sign in to Orbit
          </a>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Kinisis Operations · Internal use only
        </p>
      </div>
    </div>
  );
}
