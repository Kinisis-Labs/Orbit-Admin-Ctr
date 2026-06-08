import { DataSourceBadge } from "@/components/data-source-badge";

interface CostDataSourceBadgeProps {
  dataSource: "live" | "cached" | "mock" | "placeholder" | "none" | undefined;
  dataAsOf?: string | null;
}

export function CostDataSourceBadge({ dataSource, dataAsOf }: CostDataSourceBadgeProps) {
  return (
    <DataSourceBadge
      dataSource={dataSource}
      dataAsOf={dataAsOf}
      label="Azure Cost Management"
    />
  );
}
