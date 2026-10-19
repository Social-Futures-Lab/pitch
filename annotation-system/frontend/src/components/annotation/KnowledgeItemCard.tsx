import { renderMarkdown } from "@/components/common/renderMarkdown";

interface KnowledgeItemCardProps {
  neutralizedIdealResponse: string;
  contributionType?: string;
  status: "placed" | "do-not-surface" | "pending";
}

const STATUS_CONFIG = {
  placed: {
    label: "Placed",
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
    dot: "bg-green-500",
  },
  "do-not-surface": {
    label: "Should not appear",
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
    dot: "bg-gray-400",
  },
  pending: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
};

export default function KnowledgeItemCard({
  neutralizedIdealResponse,
  status,
}: KnowledgeItemCardProps) {
  const statusConfig = STATUS_CONFIG[status];

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">
            Proposed Inserted Message
          </h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`}
            />
            {statusConfig.label}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed text-gray-700">
          {renderMarkdown(neutralizedIdealResponse)}
        </p>
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5">
        <p className="text-xs italic text-gray-400">
          You may imagine small wording changes when deciding where this message
          should appear.
        </p>
      </div>
    </div>
  );
}
