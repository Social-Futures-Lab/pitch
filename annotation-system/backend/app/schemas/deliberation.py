from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class PeerAnnotationOut(BaseModel):
    annotator_label: str  # "Annotator A", "Annotator B", etc.
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    do_not_surface: bool
    extends_before: bool = False
    extends_after: bool = False
    rationale: Optional[str] = None
    contribution_type: Optional[str] = None
    pertinence: Optional[float] = None


class PeersResponse(BaseModel):
    peers: List[PeerAnnotationOut]
    own_annotation: dict  # the user's original annotation


class RevisionCreate(BaseModel):
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    do_not_surface: Optional[bool] = None
    extends_before: Optional[bool] = None
    extends_after: Optional[bool] = None
    rationale: Optional[str] = None
    contribution_type: Optional[str] = None
    contribution_type_detail: Optional[str] = None
    pertinence: Optional[float] = None


class VisibilityLog(BaseModel):
    visible_annotation_ids: List[str]
