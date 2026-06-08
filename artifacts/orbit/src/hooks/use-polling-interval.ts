import { useState } from "react";

export const POLL_OPTIONS = [
  { label: "15 s", value: 15_000 },
  { label: "30 s", value: 30_000 },
  { label: "60 s", value: 60_000 },
  { label: "Off", value: 0 },
] as const;

export type PollValue = (typeof POLL_OPTIONS)[number]["value"];

export function parsePollValue(raw: string | null): PollValue {
  const n = Number(raw);
  return (POLL_OPTIONS.map((o) => o.value) as number[]).includes(n)
    ? (n as PollValue)
    : 60_000;
}

export function usePollingInterval(storageKey: string): [PollValue, (v: PollValue) => void] {
  const [value, setValue] = useState<PollValue>(() =>
    parsePollValue(localStorage.getItem(storageKey))
  );
  function set(v: PollValue) {
    setValue(v);
    localStorage.setItem(storageKey, String(v));
  }
  return [value, set];
}
