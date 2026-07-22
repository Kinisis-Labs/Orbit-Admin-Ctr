import type { z } from "zod";
import { CorpusErrorSchema } from "./schemas";

export class CorpusApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly correlationId: string | null,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function createIdempotencyKey(operation: string): string {
  return `${operation}:${crypto.randomUUID()}`;
}

export async function corpusApi<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/grailscan-corpus${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = CorpusErrorSchema.safeParse(value);
    if (parsed.success) {
      throw new CorpusApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        response.status,
        parsed.data.error.correlationId ?? null,
        parsed.data.error.details,
      );
    }
    throw new CorpusApiError(
      "grailscan_corpus_invalid_proxy_response",
      "Orbit returned an invalid Golden Corpus response",
      response.status,
      null,
    );
  }
  return schema.parse(value);
}
