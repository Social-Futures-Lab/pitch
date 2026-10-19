import { useState } from "react";
import type { PeerAnnotation, Annotation } from "@/types";
import { PEER_COLORS, OWN_COLOR } from "./PeerOverlay";
import { PERTINENCE_LABELS } from "@/constants";

interface AnnotationDetailsPanelProps {
  peers: PeerAnnotation[];
  ownOriginalAnnotation?: Annotation | null;
}

const CONTRIBUTION_LABELS: Record<string, string> = {
  heads_up: "Heads-up",
  pushback_support: "Pushback or support",
  suggestion: "Suggestion",
  others: "Others",
};

interface AnnotationCardProps {
  label: string;
  color: { fill: string; border: string; dot: string };
  initial: string;
  windowStart: number | null;
  windowEnd: number | null;
  bestTurn: number | null;
  doNotSurface: boolean;
  extendsBefore?: boolean;
  extendsAfter?: boolean;
  rationale?: string | null;
  contributionType?: string | null;
  pertinence?: number | null;
  isOwn?: boolean;
}

function AnnotationCard({
  label,
  color,
  initial,
  windowStart,
  windowEnd,
  bestTurn,
  doNotSurface,
  extendsBefore = false,
  extendsAfter = false,
  rationale,
  contributionType,
  pertinence,
  isOwn = false,
}: AnnotationCardProps) {
  const hasRationale = rationale && rationale.trim().length > 0;

  return (
    <div
      className={`rounded-lg border-l-4 bg-white p-3 shadow-sm ${
        isOwn ? "bg-amber-50/30" : ""
      }`}
      style={{ borderLeftColor: color.border }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <span
          className="inline-flex h-5 w-3.5 shrink-0 items-start justify-center rounded-sm pt-0.5"
          style={{
            backgroundColor: color.fill,
            borderLeft: `3px solid ${color.border}`,
          }}
        >
          <span
            className="text-[8px] font-bold leading-none"
            style={{ color: color.dot }}
          >
            {initial}
          </span>
        </span>
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {isOwn && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
            Locked Original
          </span>
        )}
      </div>

      {/* Details */}
      <div className="ml-6 space-y-1.5 text-xs">
        {doNotSurface ? (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-600">Decision:</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
              Should not appear
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-600">Window:</span>
              <span className="font-mono text-gray-800">
                {windowStart !== null && windowEnd !== null
                  ? `#${windowStart} - #${windowEnd}`
                  : "Not set"}
              </span>
            </div>
            {bestTurn !== null && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">Best turn:</span>
                <span className="font-mono text-gray-800">#{bestTurn}</span>
              </div>
            )}
            {(extendsBefore || extendsAfter) && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">Extends:</span>
                <span className="text-gray-800">
                  {extendsBefore && extendsAfter
                    ? "Before & after"
                    : extendsBefore
                    ? "Before"
                    : "After"}
                </span>
              </div>
            )}
            {contributionType && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">Contribution:</span>
                <span className="text-gray-800">
                  {CONTRIBUTION_LABELS[contributionType] || contributionType}
                </span>
              </div>
            )}
            {pertinence !== null && pertinence !== undefined && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">Importance:</span>
                <span className="text-gray-800">
                  {PERTINENCE_LABELS[pertinence] || `${pertinence}`}
                </span>
              </div>
            )}
          </>
        )}

        {/* Rationale section - always visible */}
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs font-medium text-gray-600 mb-1.5">
            Rationale:
          </div>
          <div className="rounded bg-gray-50 px-2.5 py-2 text-xs text-gray-700 leading-relaxed">
            {hasRationale ? (
              <p className="whitespace-pre-wrap">{rationale}</p>
            ) : (
              <p className="italic text-gray-400">(No rationale provided)</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnnotationDetailsPanel({
  peers,
  ownOriginalAnnotation,
}: AnnotationDetailsPanelProps) {
  const [isHelpExpanded, setIsHelpExpanded] = useState(false);
  const showOwnAnnotation =
    ownOriginalAnnotation && !ownOriginalAnnotation.do_not_surface;

  if (peers.length === 0 && !showOwnAnnotation) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Peer Annotations
        </p>
        <p className="mt-2 text-sm text-gray-400">
          No peer annotations visible for this item.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Annotations
      </p>

      {/* Help section */}
      <div className="mb-3">
        <button
          onClick={() => setIsHelpExpanded(!isHelpExpanded)}
          className="flex w-full items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          aria-expanded={isHelpExpanded}
        >
          <svg
            className={`h-3 w-3 transition-transform duration-200 ${
              isHelpExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <span>What do these colors mean?</span>
        </button>
        {isHelpExpanded && (
          <div className="mt-2 rounded bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
            Each participant is assigned a unique color. You'll see this color in
            two places:
            <ul className="mt-1.5 ml-3 space-y-1 list-disc">
              <li>
                In these cards as a colored left border and badge with their
                initial
              </li>
              <li>
                In the conversation transcript as vertical colored stripes
                marking the turns where they believe the message could appear
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Annotation cards */}
      <div className="space-y-3">
        {/* Show own original annotation FIRST if it exists and is not do-not-surface */}
        {showOwnAnnotation && (
          <AnnotationCard
            label="Your Original Annotation"
            color={OWN_COLOR}
            initial="Y"
            windowStart={ownOriginalAnnotation.window_start_turn_number}
            windowEnd={ownOriginalAnnotation.window_end_turn_number}
            bestTurn={ownOriginalAnnotation.best_turn_number}
            doNotSurface={ownOriginalAnnotation.do_not_surface}
            extendsBefore={ownOriginalAnnotation.extends_before}
            extendsAfter={ownOriginalAnnotation.extends_after}
            rationale={ownOriginalAnnotation.rationale}
            contributionType={ownOriginalAnnotation.contribution_type}
            pertinence={ownOriginalAnnotation.pertinence}
            isOwn
          />
        )}

        {/* Show own annotation even if it's do-not-surface */}
        {ownOriginalAnnotation && ownOriginalAnnotation.do_not_surface && (
          <AnnotationCard
            label="Your Original Annotation"
            color={OWN_COLOR}
            initial="Y"
            windowStart={null}
            windowEnd={null}
            bestTurn={null}
            doNotSurface={true}
            rationale={ownOriginalAnnotation.rationale}
            contributionType={ownOriginalAnnotation.contribution_type}
            pertinence={ownOriginalAnnotation.pertinence}
            isOwn
          />
        )}

        {/* Show peer annotations */}
        {peers.map((peer, idx) => {
          const color = PEER_COLORS[idx % PEER_COLORS.length];
          const initial = peer.annotator_label
            .replace("Annotator ", "")
            .replace("Original author", "O")
            .charAt(0);
          return (
            <AnnotationCard
              key={peer.annotator_label}
              label={peer.annotator_label}
              color={color}
              initial={initial}
              windowStart={peer.window_start_turn_number}
              windowEnd={peer.window_end_turn_number}
              bestTurn={peer.best_turn_number}
              doNotSurface={peer.do_not_surface}
              extendsBefore={peer.extends_before}
              extendsAfter={peer.extends_after}
              rationale={peer.rationale}
              contributionType={peer.contribution_type}
              pertinence={peer.pertinence}
            />
          );
        })}
      </div>
    </div>
  );
}
