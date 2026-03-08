import React from 'react';

export default function ContentPlanContextCard({
  context = {},
  confidenceStyle = {},
  onOpenVault = null,
}) {
  const sourceSummary = Array.isArray(context?.sources)
    ? context.sources
        .filter((source) => source?.active)
        .map((source) => {
          const count = Number(source?.count || 0);
          return count > 0 ? `${source.label} (${count})` : source.label;
        })
        .slice(0, 3)
    : [];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-900">Plan context</h3>
        <span className={`text-xs font-medium inline-flex items-center gap-1 ${confidenceStyle.text || 'text-gray-600'}`}>
          <span className={`h-2 w-2 rounded-full ${confidenceStyle.dot || 'bg-gray-400'}`} />
          {confidenceStyle.label || 'Unknown confidence'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">Niche</p>
          <p className="font-medium text-gray-900">{context?.niche || 'N/A'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">Audience</p>
          <p className="font-medium text-gray-900">{context?.audience || 'N/A'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">Tone</p>
          <p className="font-medium text-gray-900">{context?.tone || 'N/A'}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sourceSummary.length > 0 ? (
          sourceSummary.map((sourceItem) => (
            <span
              key={sourceItem}
              className="rounded-full border border-green-200 bg-green-50 text-green-700 px-2.5 py-1 text-xs"
            >
              {sourceItem}
            </span>
          ))
        ) : (
          <span className="text-xs text-gray-500">No strong source signals yet.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
        <p className="text-xs text-blue-800">
          Detailed skills, about, experience, and signal breakdown are available in Context Vault.
        </p>
        {typeof onOpenVault === 'function' && (
          <button
            type="button"
            onClick={onOpenVault}
            className="rounded-lg bg-white border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Open Context Vault
          </button>
        )}
      </div>
    </section>
  );
}
