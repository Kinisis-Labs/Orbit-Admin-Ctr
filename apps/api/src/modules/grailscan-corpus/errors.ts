import type { Response } from "express";

export interface CorpusProxyErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string | null;
    details?: unknown;
  };
}

export function sendCorpusProxyError(
  res: Response,
  status: number,
  code: string,
  message: string,
  correlationId: string | null = null,
): void {
  res
    .status(status)
    .json({ error: { code, message, correlationId } } satisfies CorpusProxyErrorBody);
}

export function isCorpusErrorBody(value: unknown): value is CorpusProxyErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string",
  );
}
