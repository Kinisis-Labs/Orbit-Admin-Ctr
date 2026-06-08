import { useState, useEffect } from "react";
import { setBudgetThreshold } from "@/lib/spend-threshold";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";

export function getBudgetBarClass(utilPct: number, budgetThreshold: number): string {
  if (utilPct >= 100) return "[&>div]:!bg-red-500";
  if (utilPct >= budgetThreshold) return "[&>div]:!bg-amber-500";
  return "";
}

export function BudgetThresholdPopover({
  appId,
  utilPct,
  rawUtilPct,
  budgetThreshold,
  className,
}: {
  appId: string;
  utilPct: number;
  rawUtilPct: number;
  budgetThreshold: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(budgetThreshold);

  useEffect(() => { setDraft(budgetThreshold); }, [budgetThreshold]);

  function handleCommit(value: number) {
    setBudgetThreshold(appId, value);
    window.dispatchEvent(new Event("orbit-budget-threshold-changed"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`block w-full text-left ${className ?? ""}`}
          title={`Alert at ${budgetThreshold}% · click to adjust`}
          onClick={(e) => e.stopPropagation()}
        >
          <Progress
            value={utilPct}
            className={`h-1.5 rounded-none bg-muted ${getBudgetBarClass(utilPct, budgetThreshold)} cursor-pointer`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-foreground">Alert threshold</span>
            <span className="text-[12px] font-semibold tabular-nums text-foreground">{draft}%</span>
          </div>
          <Slider
            min={10}
            max={100}
            step={5}
            value={[draft]}
            onValueChange={([v]) => setDraft(v)}
            onValueCommit={([v]) => handleCommit(v)}
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>10%</span>
            <span>{rawUtilPct.toFixed(0)}% utilized now</span>
            <span>100%</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            The budget bar turns amber when MTD spend exceeds this threshold.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
