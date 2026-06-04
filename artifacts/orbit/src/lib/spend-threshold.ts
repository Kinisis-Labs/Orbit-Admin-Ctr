export const DEFAULT_SPEND_THRESHOLD = 15;
const STORAGE_KEY = "orbit-spend-thresholds";

function getAll(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
  catch { return {}; }
}

export function getSpendThreshold(appId: string): number {
  const stored = getAll()[appId];
  if (stored !== undefined && Number.isFinite(stored) && stored > 0) return stored;
  return DEFAULT_SPEND_THRESHOLD;
}

export function setSpendThreshold(appId: string, value: number): void {
  const all = getAll();
  all[appId] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function removeSpendThreshold(appId: string): void {
  const all = getAll();
  delete all[appId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearSpendThresholds(): void {
  localStorage.removeItem(STORAGE_KEY);
}
