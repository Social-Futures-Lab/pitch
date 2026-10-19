"""Pydantic v2 schemas for the Cross-Annotation phase (Module 2 — Phase 4)."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class AnnotationCreate(BaseModel):
    excerpt_id: str
    knowledge_item_id: str
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    do_not_surface: bool = False
    extends_before: bool = False
    extends_after: bool = False
    contribution_type: Optional[str] = None
    contribution_type_detail: Optional[str] = None
    pertinence: Optional[float] = None
    rationale: Optional[str] = None


class AnnotationUpdate(BaseModel):
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    do_not_surface: Optional[bool] = None
    extends_before: Optional[bool] = None
    extends_after: Optional[bool] = None
    contribution_type: Optional[str] = None
    contribution_type_detail: Optional[str] = None
    pertinence: Optional[float] = None
    rationale: Optional[str] = None


class AnnotationOut(BaseModel):
    id: str
    excerpt_id: str
    knowledge_item_id: str
    annotator_id: str
    annotator_role: str
    phase: str
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    do_not_surface: bool
    extends_before: bool
    extends_after: bool
    contribution_type: Optional[str] = None
    contribution_type_detail: Optional[str] = None
    pertinence: Optional[float] = None
    rationale: Optional[str] = None
    revision_of_id: Optional[str] = None
    created_at: datetime


class ExcerptOut(BaseModel):
    id: str
    conversation_id: str
    knowledge_item_id: str
    start_turn_number: int
    end_turn_number: int
    conversation_min_turn: int = 1
    conversation_max_turn: int = 1
    preceding_context_summary: Optional[str] = None
    following_context_summary: Optional[str] = None
    turns: list[Any]  # list of turn dicts
    knowledge_item: dict[str, Any]  # neutralized item info


class AssignmentOut(BaseModel):
    excerpt_id: str
    conversation_id: str
    knowledge_item_id: str
    excerpt_start_turn: int
    excerpt_end_turn: int
    item_contribution_type: str
    completed: bool


class RankedItem(BaseModel):
    knowledge_item_id: str
    rank: int
    chosen_best_turn_number: int


class PriorityRankingCreate(BaseModel):
    ranked_items: list[RankedItem]


class PriorityRankingOut(BaseModel):
    id: str
    excerpt_id: str
    annotator_id: str
    phase: str
    ranked_items: list[Any]
    created_at: datetime


class ProgressOut(BaseModel):
    total: int
    completed: int
    pending: int
