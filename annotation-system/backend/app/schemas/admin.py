from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class StudyGroupCreate(BaseModel):
    scenario: str  # "scholar" | "trip"
    prompt_id: Optional[str] = None


class StudyGroupOut(BaseModel):
    id: str
    scenario: str
    status: str
    join_code: str
    prompt_id: Optional[str] = None
    member_count: int
    created_at: datetime


class PhaseTransition(BaseModel):
    target_status: str  # GroupStatus value


class PromptCreate(BaseModel):
    scenario: str
    text: str
    pre_identified_items: Optional[list] = None


class PromptOut(BaseModel):
    id: str
    scenario: str
    text: str
    pre_identified_items: Optional[list] = None
    created_at: datetime


class ItemReviewAction(BaseModel):
    action: str  # "approve" | "reject" | "edit"
    edited_neutralized_response: Optional[str] = None


class NeutralizationTrigger(BaseModel):
    pass  # triggers auto-neutralization


class ExcerptUpdate(BaseModel):
    start_turn_number: Optional[int] = None
    end_turn_number: Optional[int] = None
    preceding_context_summary: Optional[str] = None
    following_context_summary: Optional[str] = None


class UserCreate(BaseModel):
    name: str
    email: str
    role: str
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
