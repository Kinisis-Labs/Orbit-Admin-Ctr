const LAST_TAB_KEY = "orbit-last-tab";
const VALID_TABS = ["overview", "infrastructure", "network", "telemetry", "cost", "ledger", "alerts"] as const;

export type ValidTab = (typeof VALID_TABS)[number];

export function readLastTab(appId?: string): ValidTab {
  try {
    const perApp = appId ? localStorage.getItem(`${LAST_TAB_KEY}:${appId}`) : null;
    const t = perApp ?? localStorage.getItem(LAST_TAB_KEY) ?? "overview";
    return (VALID_TABS as readonly string[]).includes(t) ? (t as ValidTab) : "overview";
  } catch {
    return "overview";
  }
}

export function appDetailHref(appId: string, tab?: ValidTab): string {
  const t = tab ?? readLastTab(appId);
  return `/apps/${appId}?tab=${t}`;
}
