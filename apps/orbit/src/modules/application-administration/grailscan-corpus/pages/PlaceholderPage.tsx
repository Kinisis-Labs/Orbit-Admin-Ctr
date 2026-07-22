import { Panel } from "../components/Ui";

export function CorpusPlaceholderPage({ title }: { title: string }) {
  return (
    <Panel className="p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[var(--orbit-text-muted)]">
        This section is delivered in a later reviewed milestone.
      </p>
    </Panel>
  );
}
