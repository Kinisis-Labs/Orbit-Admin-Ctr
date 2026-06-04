import { useState, useEffect, useCallback } from "react";

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

export function useSpendThreshold(appId: string): number {
  const [threshold, setThreshold] = useState(() => getSpendThreshold(appId));
  const refresh = useCallback(() => setThreshold(getSpendThreshold(appId)), [appId]);
  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("orbit-spend-threshold-changed", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("orbit-spend-threshold-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);
  return threshold;
}

export const DEFAULT_BUDGET_THRESHOLD = 80;
const BUDGET_STORAGE_KEY = "orbit-budget-thresholds";

function getAllBudget(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BUDGET_STORAGE_KEY) ?? "{}"); }
  catch { return {}; }
}

export function getBudgetThreshold(appId: string): number {
  const stored = getAllBudget()[appId];
  if (stored !== undefined && Number.isFinite(stored) && stored > 0 && stored <= 100) return stored;
  return DEFAULT_BUDGET_THRESHOLD;
}

export function setBudgetThreshold(appId: string, value: number): void {
  const all = getAllBudget();
  all[appId] = value;
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(all));
}

export function removeBudgetThreshold(appId: string): void {
  const all = getAllBudget();
  delete all[appId];
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(all));
}

export function clearBudgetThresholds(): void {
  localStorage.removeItem(BUDGET_STORAGE_KEY);
}

export function useBudgetThreshold(appId: string): number {
  const [threshold, setThreshold] = useState(() => getBudgetThreshold(appId));
  const refresh = useCallback(() => setThreshold(getBudgetThreshold(appId)), [appId]);
  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === BUDGET_STORAGE_KEY) refresh();
    };
    window.addEventListener("orbit-budget-threshold-changed", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("orbit-budget-threshold-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);
  return threshold;
}
