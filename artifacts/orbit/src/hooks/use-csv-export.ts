import { useState } from "react";

export type CsvRow = string[];

function buildCsvString(headers: string[], rows: CsvRow[]): string {
  return [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function useCsvExport(
  rows: CsvRow[] | undefined | null,
  headers: string[],
  filename: string,
) {
  const [copied, setCopied] = useState(false);

  const disabled = !rows || rows.length === 0;

  function fallbackCopy(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently skip
    } finally {
      document.body.removeChild(ta);
    }
  }

  function handleExport() {
    if (disabled) return;
    const csv = buildCsvString(headers, rows!);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (disabled) return;
    const csv = buildCsvString(headers, rows!);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(csv)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          fallbackCopy(csv);
        });
    } else {
      fallbackCopy(csv);
    }
  }

  return { copied, disabled, handleExport, handleCopy };
}
