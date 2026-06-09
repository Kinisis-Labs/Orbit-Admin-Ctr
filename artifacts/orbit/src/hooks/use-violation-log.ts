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

function pruneExpired(entries: ViolationEntry[]): ViolationEntry[] {
  const cutoff = Date.now() - TTL_MS;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

function readLog(): ViolationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ViolationEntry[];
    return pruneExpired(parsed);
  } catch {
    return [];
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

export function useViolationLog() {
  const [entries, setEntries] = useState<ViolationEntry[]>(() => readLog());

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

  const unseenCount = entries.filter((e) => !e.seen).length;

  return { entries, unseenCount, markSeen, clear, clearByApp, removeById };
}
