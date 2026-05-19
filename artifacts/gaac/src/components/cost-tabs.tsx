import { Link, useLocation } from "wouter";

const TABS = [
  { href: "/cost", label: "Overview" },
  { href: "/cost/budgets", label: "Budgets" },
  { href: "/cost/forecasts", label: "Forecasts" },
];

export function CostTabs() {
  const [location] = useLocation();
  return (
    <div className="border-b border-border -mt-2 mb-2">
      <nav className="flex gap-1">
        {TABS.map((t) => {
          const active = location === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-1.5 text-[13px] border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
