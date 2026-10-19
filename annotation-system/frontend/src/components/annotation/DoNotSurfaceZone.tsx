interface DoNotSurfaceZoneProps {
  active: boolean;
  rationale: string;
  onToggle: (active: boolean) => void;
  onRationaleChange: (rationale: string) => void;
}

export default function DoNotSurfaceZone({
  active,
  rationale,
  onToggle,
  onRationaleChange,
}: DoNotSurfaceZoneProps) {
  return (
    <div
      className={`rounded-lg border-2 transition-colors ${
        active
          ? "border-gray-400 bg-gray-100"
          : "border-dashed border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
      }`}
    >
      <button
        type="button"
        data-testid="do-not-surface-toggle"
        onClick={() => onToggle(!active)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            active ? "bg-gray-600 text-white" : "bg-gray-200 text-gray-500"
          }`}
        >
          {active ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-medium ${active ? "text-gray-800" : "text-gray-600"}`}>
            {active ? "Marked as should not appear" : "Should not appear"}
          </p>
          <p className="text-xs text-gray-500">
            {active
              ? "This message is excluded from placement. Click to add it back to the conversation."
              : "Choose this if the message would not be relevant, useful, or appropriate at any point in the transcript"}
          </p>
        </div>
        {active && (
          <span className="shrink-0 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors">
            Add back to conversation
          </span>
        )}
      </button>

      {active && (
        <div className="border-t border-gray-300 px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              Rationale (optional)
            </span>
            <textarea
              value={rationale}
              onChange={(e) => onRationaleChange(e.target.value)}
              placeholder="Why should this message not appear here?"
              rows={2}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
        </div>
      )}
    </div>
  );
}
