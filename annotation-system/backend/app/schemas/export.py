"""Pydantic v2 schemas for the Export Pipeline (Phase 6)."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class PickBestTurnExport(BaseModel):
    excerpt_id: str
    knowledge_item_id: str
    transcript_turns: list[Any]
    context_before: Optional[str] = None
    context_after: Optional[str] = None
    neutralized_item: str
    contribution_type: str
    consensus_window_start: Optional[int] = None
    consensus_window_end: Optional[int] = None
    consensus_best_turn: Optional[int] = None
    consensus_status: str
    annotator_agreement: float


class TurnByTurnExport(PickBestTurnExport):
    replay_start_turn: Optional[int] = None  # t_start for incremental reveal


class PrioritizedExport(BaseModel):
    excerpt_id: str
    transcript_turns: list[Any]
    items: list[Any]  # list of {item, consensus_window_start, contribution_type}
    consensus_ranking: list[Any]  # [{item_id, rank, best_turn}]
    agreement_score: float


class AblationExport(BaseModel):
    variant: str  # "no_context" | "shuffled" | "quality"
    data: list[Any]


class AgreementStats(BaseModel):
    total_pairs: int
    well_defined: int
    contested: int
    do_not_surface: int
    mean_agreement: float
    fleiss_kappa: Optional[float] = None
    kendalls_w: Optional[float] = None


class BulkExport(BaseModel):
    conversations: list[Any]
    knowledge_items: list[Any]
    annotations: list[Any]
    consensus_windows: list[Any]
    priority_rankings: list[Any]
