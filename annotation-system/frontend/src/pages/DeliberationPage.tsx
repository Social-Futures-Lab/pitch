import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { PERTINENCE_LEVELS, PERTINENCE_LABELS } from "@/constants";
import type {
  Turn,
  ExcerptDetail,
  Annotation,
  PeerAnnotation,
} from "@/types";
import { getExcerptDetail } from "@/api/annotation";
import { renderMarkdown } from "@/components/common/renderMarkdown";
import {
  getPeerAnnotations,
  createRevision,
  getMyOriginal,
  logVisibility,
  getDeliberationAssignments,
  type DeliberationAssignment,
} from "@/api/deliberation";
import PeerOverlay from "@/components/deliberation/PeerOverlay";
import type { SelectingFor } from "@/components/deliberation/PeerOverlay";
import AnnotationDetailsPanel from "@/components/deliberation/AnnotationDetailsPanel";
import DiffIndicator from "@/components/deliberation/DiffIndicator";
import DoNotSurfaceZone from "@/components/annotation/DoNotSurfaceZone";

interface PlacementWindow {
  startTurn: number | null;
  endTurn: number | null;
  bestTurn: number | null;
}

export default function DeliberationPage() {
  const { excerptId } = useParams<{ excerptId: string }>();
  const [searchParams] = useSearchParams();
  const knowledgeItemId = searchParams.get("knowledge_item_id") ?? "";
  const conversationScope = searchParams.get("conversation");
  const { user } = useAuth();
  const navigate = useNavigate();

  // --- Data state ---
  const [allAssignments, setAllAssignments] = useState<DeliberationAssignment[]>([]);
  const [excerpt, setExcerpt] = useState<ExcerptDetail | null>(null);
  const [peers, setPeers] = useState<PeerAnnotation[]>([]);
  const [ownAnnotation, setOwnAnnotation] = useState<Annotation | null>(null);
  const [originalAnnotation, setOriginalAnnotation] =
    useState<Annotation | null>(null);

  // --- UI state ---
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Editable annotation state ---
  const [doNotSurface, setDoNotSurface] = useState(false);
  const [extendsBefore, setExtendsBefore] = useState(false);
  const [extendsAfter, setExtendsAfter] = useState(false);
  const [rationale, setRationale] = useState("");
  const [contributionType, setContributionType] = useState("");
  const [contributionTypeDetail, setContributionTypeDetail] = useState("");
  const [pertinence, setPertinence] = useState<number>(-1);
  const [placementWindow, setPlacementWindow] = useState<PlacementWindow>({
    startTurn: null,
    endTurn: null,
    bestTurn: null,
  });

  // --- Turn selection mode ---
  const [selectingFor, setSelectingFor] = useState<SelectingFor>(null);

  // --- Displayed turn count ---
  const [displayedTurnCount, setDisplayedTurnCount] = useState(0);

  // --- Resizable panel ---
  const [leftPct, setLeftPct] = useState(55);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // --- Load data ---
  useEffect(() => {
    if (!excerptId || !knowledgeItemId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [excerptData, peersData, originalData, assignData] = await Promise.all([
          getExcerptDetail(excerptId!),
          getPeerAnnotations(excerptId!, knowledgeItemId),
          getMyOriginal(excerptId!, knowledgeItemId),
          getDeliberationAssignments(),
        ]);

        if (cancelled) return;

        setAllAssignments(
          conversationScope
            ? assignData.filter((a) => a.conversation_id === conversationScope)
            : assignData
        );
        setExcerpt(excerptData);
        setPeers(peersData.peers);
        setOriginalAnnotation(peersData.own_annotation); // Original cross-annotation
        setOwnAnnotation(originalData); // Current state (deliberation revision or fallback to original)

        // Initialize editable state from current annotation (deliberation revision if exists)
        setDoNotSurface(originalData.do_not_surface);
        setExtendsBefore(originalData.extends_before);
        setExtendsAfter(originalData.extends_after);
        setRationale(originalData.rationale ?? "");
        setContributionType(originalData.contribution_type ?? "");
        setContributionTypeDetail(originalData.contribution_type_detail ?? "");
        setPertinence(originalData.pertinence ?? -1);
        setPlacementWindow({
          startTurn: originalData.window_start_turn_number,
          endTurn: originalData.window_end_turn_number,
          bestTurn: originalData.best_turn_number,
        });
      } catch {
        if (!cancelled) setLoadError("Failed to load deliberation data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [excerptId, knowledgeItemId, conversationScope]);

  // --- Log visibility on mount ---
  useEffect(() => {
    if (!excerptId || !knowledgeItemId || !ownAnnotation) return;
    const visibleIds = peers.map((p) => p.annotator_label);
    logVisibility(excerptId, knowledgeItemId, visibleIds).catch(() => {
      // Fire-and-forget
    });
  }, [excerptId, knowledgeItemId, peers, ownAnnotation]);

  // --- Speaker map ---
  const turns: Turn[] = excerpt?.turns ?? [];
  const speakerMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const turn of turns) {
      if (!map.has(turn.speaker_id)) {
        map.set(turn.speaker_id, idx++);
      }
    }
    return map;
  }, [turns]);

  // --- Turn selection (button-driven) ---
  const handleTurnClick = useCallback(
    (turnNumber: number) => {
      if (!selectingFor || doNotSurface) return;
      setPlacementWindow((prev) => {
        const w = { ...prev };
        if (selectingFor === "start") {
          w.startTurn = turnNumber;
          if (w.endTurn !== null && w.endTurn < turnNumber) w.endTurn = null;
          if (w.bestTurn !== null && (w.endTurn === null || w.bestTurn < turnNumber || w.bestTurn > (w.endTurn ?? turnNumber))) w.bestTurn = null;
        } else if (selectingFor === "end") {
          w.endTurn = turnNumber;
          if (w.bestTurn !== null && w.bestTurn > turnNumber) w.bestTurn = null;
        } else if (selectingFor === "best") {
          w.bestTurn = turnNumber;
        }
        return w;
      });
      setSelectingFor(null);
    },
    [selectingFor, doNotSurface]
  );

  // --- Toggle do-not-surface ---
  const handleDoNotSurfaceToggle = useCallback((active: boolean) => {
    setSelectingFor(null);
    setDoNotSurface(active);
  }, []);

  // --- Save revision ---
  const handleSave = useCallback(async () => {
    if (!excerptId || !knowledgeItemId) return;

    if (
      !doNotSurface &&
      (placementWindow.startTurn === null ||
        placementWindow.endTurn === null ||
        placementWindow.bestTurn === null)
    ) {
      setSaveError(
        "Please complete the placement window (start, end, and best turn) or mark as should not appear."
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const revision = await createRevision(excerptId, knowledgeItemId, {
        window_start_turn_number: doNotSurface
          ? null
          : placementWindow.startTurn,
        window_end_turn_number: doNotSurface ? null : placementWindow.endTurn,
        best_turn_number: doNotSurface ? null : placementWindow.bestTurn,
        do_not_surface: doNotSurface,
        extends_before: extendsBefore,
        extends_after: extendsAfter,
        rationale: rationale.trim() || undefined,
        contribution_type: doNotSurface ? null : (contributionType || null),
        contribution_type_detail: doNotSurface || contributionType !== "others" ? null : (contributionTypeDetail || null),
        pertinence: doNotSurface ? null : (pertinence >= 0 ? pertinence : null),
      });
      setOwnAnnotation(revision);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError("Failed to save revision. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    excerptId,
    knowledgeItemId,
    doNotSurface,
    placementWindow,
    extendsBefore,
    extendsAfter,
    rationale,
    contributionType,
    contributionTypeDetail,
    pertinence,
  ]);

  // --- Resize handle drag ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(30, Math.min(70, pct)));
    };

    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // --- Navigation across assignments ---
  const globalIndex = useMemo(() => {
    const idx = allAssignments.findIndex(
      (a) => a.excerpt_id === excerptId && a.knowledge_item_id === knowledgeItemId
    );
    return idx >= 0 ? idx : 0;
  }, [allAssignments, excerptId, knowledgeItemId]);

  const percentage = allAssignments.length > 0
    ? Math.round(((globalIndex + 1) / allAssignments.length) * 100)
    : 0;

  const handlePrevious = useCallback(() => {
    const prevIdx = globalIndex - 1;
    if (prevIdx < 0) return;
    const prev = allAssignments[prevIdx];
    const qs = conversationScope ? `&conversation=${conversationScope}` : "";
    navigate(`/deliberation/${prev.excerpt_id}?knowledge_item_id=${prev.knowledge_item_id}${qs}`);
  }, [globalIndex, allAssignments, navigate, conversationScope]);

  const handleNext = useCallback(() => {
    const nextIdx = globalIndex + 1;
    if (nextIdx >= allAssignments.length) {
      const qs = conversationScope ? `?conversation=${conversationScope}` : "";
      navigate(`/deliberation/summary${qs}`);
      return;
    }
    const next = allAssignments[nextIdx];
    const qs = conversationScope ? `&conversation=${conversationScope}` : "";
    navigate(`/deliberation/${next.excerpt_id}?knowledge_item_id=${next.knowledge_item_id}${qs}`);
  }, [globalIndex, allAssignments, navigate, conversationScope]);

  // --- Current state for diff comparison ---
  const currentState = {
    window_start_turn_number: doNotSurface ? null : placementWindow.startTurn,
    window_end_turn_number: doNotSurface ? null : placementWindow.endTurn,
    best_turn_number: doNotSurface ? null : placementWindow.bestTurn,
    do_not_surface: doNotSurface,
    pertinence: doNotSurface ? null : (pertinence >= 0 ? pertinence : null),
  };

  // --- Missing params ---
  if (!excerptId || !knowledgeItemId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">
            Missing excerpt ID or knowledge item ID.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Please navigate to this page from the annotation list.
          </p>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg
            className="h-5 w-5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading deliberation...
        </div>
      </div>
    );
  }

  // --- Error ---
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm text-indigo-600 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // --- Empty excerpt ---
  if (!excerpt || turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-400">No transcript data available.</p>
      </div>
    );
  }

  // --- Transcript panel content (shared between mobile and desktop) ---
  const transcriptContent = (
    <>
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
        <span className="text-xs text-gray-400">
          {displayedTurnCount || turns.length} turn{(displayedTurnCount || turns.length) !== 1 && "s"}
        </span>
      </div>

      <div className="flex-1 overflow-hidden">
        <PeerOverlay
          peers={peers}
          turns={turns}
          speakerMap={speakerMap}
          ownWindow={placementWindow}
          doNotSurface={doNotSurface}
          selectingFor={selectingFor}
          onTurnClick={handleTurnClick}
          conversationId={excerpt.conversation_id}
          conversationMinTurn={excerpt.conversation_min_turn}
          conversationMaxTurn={excerpt.conversation_max_turn}
          onExtendsBeforeChange={setExtendsBefore}
          onExtendsAfterChange={setExtendsAfter}
          onDisplayedTurnCountChange={setDisplayedTurnCount}
          ownOriginalAnnotation={originalAnnotation}
        />
      </div>
    </>
  );

  // --- Sidebar content (shared between mobile and desktop) ---
  const sidebarContent = (
    <>
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">Review & Revise</h2>
        {user && (
          <span className="text-xs text-gray-400">{user.name}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          {/* Knowledge item card */}
          {excerpt.knowledge_item && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Proposed Inserted Message
              </p>
              <p className="text-sm leading-relaxed text-gray-700">
                {renderMarkdown(excerpt.knowledge_item.neutralized_ideal_response)}
              </p>
              <p className="mt-2 text-xs italic text-gray-400">
                You may imagine small wording changes when deciding where this message should appear.
              </p>
            </div>
          )}

          {/* Annotation details with rationales */}
          <AnnotationDetailsPanel peers={peers} ownOriginalAnnotation={originalAnnotation} />

          {/* Own annotation controls */}
          <div className="rounded-lg border-2 border-indigo-200 bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Your Annotation
            </p>

            {/* Should not appear toggle */}
            <DoNotSurfaceZone
              active={doNotSurface}
              rationale={rationale}
              onToggle={handleDoNotSurfaceToggle}
              onRationaleChange={setRationale}
            />

            {/* Placement window with select buttons */}
            {!doNotSurface && (
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-sm font-medium text-gray-700">
                  Choose the turns after which this message could appear
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The first turn after which this message becomes relevant">First relevant:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {placementWindow.startTurn !== null ? `#${placementWindow.startTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectingFor(selectingFor === "start" ? null : "start")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "start"
                          ? "border-green-400 bg-green-100 text-green-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {selectingFor === "start" ? "Selecting..." : placementWindow.startTurn !== null ? "Change" : "Select"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The last turn after which inserting would still help">Last useful:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {placementWindow.endTurn !== null ? `#${placementWindow.endTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      disabled={placementWindow.startTurn === null}
                      onClick={() => setSelectingFor(selectingFor === "end" ? null : "end")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "end"
                          ? "border-red-400 bg-red-100 text-red-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      }`}
                    >
                      {selectingFor === "end" ? "Selecting..." : placementWindow.endTurn !== null ? "Change" : "Select"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The ideal insertion point">Best placement:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {placementWindow.bestTurn !== null ? `#${placementWindow.bestTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      disabled={placementWindow.startTurn === null || placementWindow.endTurn === null}
                      onClick={() => setSelectingFor(selectingFor === "best" ? null : "best")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "best"
                          ? "border-amber-400 bg-amber-100 text-amber-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      }`}
                    >
                      {selectingFor === "best" ? "Selecting..." : placementWindow.bestTurn !== null ? "Change" : "Select"}
                    </button>
                  </div>
                </div>
              </div>
            )}


            {/* Pertinence / importance */}
            {!doNotSurface && (() => {
              const originalP = originalAnnotation?.pertinence;
              const changed = originalP !== null && originalP !== undefined && originalP !== pertinence;

              return (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <label className="block text-sm font-medium text-gray-700">
                      How important would this message be for the conversation?
                    </label>
                    {changed && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Changed from: {PERTINENCE_LABELS[originalP!] || `${originalP}`}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {PERTINENCE_LEVELS.map((level) => (
                      <label
                        key={level.value}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                          pertinence === level.value
                            ? "border-indigo-400 bg-indigo-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="delib_pertinence"
                          checked={pertinence === level.value}
                          onChange={() => setPertinence(level.value)}
                          className="mt-0.5 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                        <span className="text-sm text-gray-700">
                          <span className="font-semibold">{level.title}</span> — {level.description}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Rationale (for placed items — do-not-surface rationale is in DoNotSurfaceZone) */}
            {!doNotSurface && (
              <div className="mt-3">
                <label
                  htmlFor="rationale"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Rationale (optional)
                </label>
                <textarea
                  id="rationale"
                  rows={3}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Explain your reasoning, especially if you changed your annotation after seeing what your peers put..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            )}

            {/* Save button and messages */}
            {saveError && (
              <p className="mt-2 text-xs text-red-600">{saveError}</p>
            )}
            {saveSuccess && (
              <p className="mt-2 text-xs text-green-600">
                Revision saved successfully.
              </p>
            )}
            <button
              type="button"
              data-testid="save-revision-button"
              onClick={handleSave}
              disabled={saving}
              className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Revision"}
            </button>
          </div>

          {/* Diff indicator */}
          <DiffIndicator original={originalAnnotation} current={currentState} />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Top bar: back link + progress + navigation */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <Link
            to="/deliberation"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            List
          </Link>

          <button
            onClick={handlePrevious}
            disabled={globalIndex <= 0}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            Prev
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>
                Item {globalIndex + 1} of {allAssignments.length}
              </span>
              <span>
                {percentage}% complete
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          <button
            onClick={handleNext}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            {globalIndex >= allAssignments.length - 1 ? "Review Summary" : "Next"}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Responsive layout: stacked on mobile, side-by-side on desktop */}
      <div
        ref={containerRef}
        className="flex flex-1 flex-col overflow-hidden lg:flex-row"
      >
        {/* Left: transcript */}
        <div
          className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:border-b-0 lg:border-r"
          style={{ flexBasis: `${leftPct}%` }}
        >
          {transcriptContent}
        </div>

        {/* Resize handle (desktop only) */}
        <div
          className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-gray-100 transition-colors hover:bg-gray-200 active:bg-indigo-100 lg:flex"
          onMouseDown={handleResizeStart}
        >
          <div className="flex flex-col gap-0.5">
            <span className="h-1 w-1 rounded-full bg-gray-400" />
            <span className="h-1 w-1 rounded-full bg-gray-400" />
            <span className="h-1 w-1 rounded-full bg-gray-400" />
          </div>
        </div>

        {/* Right: sidebar */}
        <div className="flex h-1/2 flex-col lg:h-full lg:flex-1">
          {sidebarContent}
        </div>
      </div>
    </div>
  );
}
