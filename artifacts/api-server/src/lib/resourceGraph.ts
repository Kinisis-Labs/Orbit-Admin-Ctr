import type { TokenCredential } from "@azure/identity";

const RESOURCE_GRAPH_URL =
  "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01";

interface ResourceGraphQuery {
  query: string;
  subscriptions: string[];
  managementGroups?: string[];
}

interface ResourceGraphQueryOptions {
  $top?: number;
  $skip?: number;
  $skipToken?: string;
  allowPartialScopes?: boolean;
  authorizationScopeFilter?: string;
  resultFormat?: "objectArray" | "table";
}

export interface ResourceGraphQueryResponse {
  data: unknown[];
  totalRecords?: number;
  count?: number;
  $skipToken?: string;
}

/**
 * Drop-in replacement for @azure/arm-resourcegraph ResourceGraphClient.
 * Uses fetch + TokenCredential.getToken() to avoid the @azure/core-http /
 * @azure/core-rest-pipeline AbortSignal incompatibility on Node.js 22+.
 */
export class ResourceGraphClient {
  constructor(private readonly credential: TokenCredential) {}

  async resources(
    query: ResourceGraphQuery,
    options?: ResourceGraphQueryOptions,
  ): Promise<ResourceGraphQueryResponse> {
    const tokenResponse = await this.credential.getToken(
      "https://management.azure.com/.default",
    );
    if (!tokenResponse?.token) {
      throw new Error(
        "ResourceGraphClient: failed to acquire Azure access token from credential",
      );
    }

    const body: Record<string, unknown> = {
      query: query.query,
      subscriptions: query.subscriptions,
      options: {
        resultFormat: options?.resultFormat ?? "objectArray",
        ...(options?.$top !== undefined && { top: options.$top }),
        ...(options?.$skip !== undefined && { skip: options.$skip }),
        ...(options?.$skipToken !== undefined && { skipToken: options.$skipToken }),
        ...(options?.allowPartialScopes !== undefined && {
          allowPartialScopes: options.allowPartialScopes,
        }),
        ...(options?.authorizationScopeFilter !== undefined && {
          authorizationScopeFilter: options.authorizationScopeFilter,
        }),
      },
    };
    if (query.managementGroups?.length) {
      body["managementGroups"] = query.managementGroups;
    }

    const res = await fetch(RESOURCE_GRAPH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResponse.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => `(status ${res.status})`);
      throw new Error(
        `Resource Graph API responded ${res.status} ${res.statusText}: ${text}`,
      );
    }

    const json = (await res.json()) as {
      data?: unknown[];
      totalRecords?: number;
      count?: number;
      $skipToken?: string;
    };

    return {
      data: json.data ?? [],
      totalRecords: json.totalRecords,
      count: json.count,
      $skipToken: json.$skipToken,
    };
  }
}
