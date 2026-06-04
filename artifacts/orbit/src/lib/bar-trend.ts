export const BAR_COLOR_DEFAULT = "hsl(var(--primary))";
export const BAR_COLOR_UP_MILD = "hsl(38 92% 50%)";
export const BAR_COLOR_UP_HIGH = "hsl(var(--destructive))";
export const BAR_COLOR_DOWN    = "hsl(160 84% 39%)";

export function getBarFill(vsLastWeek: number | null | undefined, threshold = 15): string {
  if (vsLastWeek == null)      return BAR_COLOR_DEFAULT;
  if (vsLastWeek > threshold)  return BAR_COLOR_UP_HIGH;
  if (vsLastWeek > 0)          return BAR_COLOR_UP_MILD;
  return BAR_COLOR_DOWN;
}
