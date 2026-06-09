import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "orbit-violation-log";
const MAX_ENTRIES = 100;
const UPDATE_EVENT = "orbit:violation-log-updated";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ViolationEntry {
  id: string;
  appId: string;
  appName: string;
  metric: "cpu" | "mem";
  value: number;
  threshold: number;
  timestamp: string;
  dismissed: boolean;
  seen: boolean;
}

function pruneExpired(entries: ViolationEntry[]): {
  entries: ViolationEntry[];
  prunedCount: number;
} {
  const cutoff = Date.now() - TTL_MS;
  const kept = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  return { entries: kept, prunedCount: entries.length - kept.length };
}

function readLog(): ViolationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ViolationEntry[];
    return pruneExpired(parsed).entries;
  } catch {
    return [];
  }
}

function readLogAndPrune(): { entries: ViolationEntry[]; prunedCount: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], prunedCount: 0 };
    const parsed = JSON.parse(raw) as ViolationEntry[];
    const result = pruneExpired(parsed);
    if (result.prunedCount > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result.entries));
      } catch {
        // ignore write failures
      }
    }
    return result;
  } catch {
    return { entries: [], prunedCount: 0 };
  }
}

function writeLog(entries: ViolationEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

export function appendViolation(
  entry: Omit<ViolationEntry, "id" | "seen">
): void {
  const existing = readLog();
  const id = `${entry.appId}:${entry.metric}:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newEntry: ViolationEntry = { ...entry, id, seen: false };
  writeLog([newEntry, ...existing].slice(0, MAX_ENTRIES));
}

export function markViolationsDismissed(
  appId: string,
  metric: "cpu" | "mem"
): void {
  const existing = readLog();
  const updated = existing.map((e) =>
    e.appId === appId && e.metric === metric && !e.dismissed
      ? { ...e, dismissed: true }
      : e
  );
  writeLog(updated);
}

export function markAllViolationsSeen(): void {
  const existing = readLog();
  if (existing.length === 0 || existing.every((e) => e.seen)) return;
  writeLog(existing.map((e) => ({ ...e, seen: true })));
}

export function markViolationsSeenByApp(appId: string): void {
  const existing = readLog();
  if (existing.every((e) => e.appId !== appId || e.seen)) return;
  writeLog(existing.map((e) => (e.appId === appId ? { ...e, seen: true } : e)));
}

export function clearViolationLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // ignore
  }
}

export function clearViolationsByApp(appId: string): void {
  const existing = readLog();
  const remaining = existing.filter((e) => e.appId !== appId);
  if (remaining.length === existing.length) return;
  writeLog(remaining);
}

export function removeViolationById(id: string): void {
  const existing = readLog();
  const remaining = existing.filter((e) => e.id !== id);
  if (remaining.length === existing.length) return;
  writeLog(remaining);
}

export function restoreViolationEntry(entry: ViolationEntry): void {
  const existing = readLog();
  if (existing.some((e) => e.id === entry.id)) return;
  const merged = [...existing, entry].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  writeLog(merged.slice(0, MAX_ENTRIES));
}

function initFromStorage(): { entries: ViolationEntry[]; prunedCount: number } {
  return readLogAndPrune();
}

export function useViolationLog() {
  const [{ entries, prunedCount: initialPrunedCount }] = useState(initFromStorage);
  const [entriesState, setEntries] = useState<ViolationEntry[]>(entries);
  const [prunedCount, setPrunedCount] = useState<number>(initialPrunedCount);

  useEffect(() => {
    function refresh() {
      setEntries(readLog());
    }
    window.addEventListener(UPDATE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(UPDATE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const markSeen = useCallback(() => {
    markAllViolationsSeen();
    setEntries(readLog());
  }, []);

  const markSeenByApp = useCallback((appId: string) => {
    markViolationsSeenByApp(appId);
    setEntries(readLog());
  }, []);

  const clear = useCallback(() => {
    clearViolationLog();
    setEntries([]);
  }, []);

  const clearByApp = useCallback((appId: string) => {
    clearViolationsByApp(appId);
    setEntries(readLog());
  }, []);

  const removeById = useCallback((id: string) => {
    removeViolationById(id);
    setEntries(readLog());
  }, []);

  const restoreEntry = useCallback((entry: ViolationEntry) => {
    restoreViolationEntry(entry);
    setEntries(readLog());
  }, []);

  const dismissPruneNotice = useCallback(() => {
    setPrunedCount(0);
  }, []);

  const unseenCount = entriesState.filter((e) => !e.seen).length;

  return { entries: entriesState, unseenCount, prunedCount, dismissPruneNotice, markSeen, markSeenByApp, clear, clearByApp, removeById, restoreEntry };
}
