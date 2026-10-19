from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator


class KnowledgeItemCreate(BaseModel):
    raw_ideal_response: str
    window_start_turn_number: int
    window_end_turn_number: int
    best_turn_number: int
    contribution_type: str  # "heads_up" | "pushback_support" | "suggestion" | "others"
    contribution_type_detail: Optional[str] = None
    pertinence: float  # 0.0 to 1.0
    ai_suggestion_used: bool = False
    ai_suggestion_text: Optional[str] = None
    notes: Optional[str] = None
    inserted_resources: Optional[str] = None  # JSON string
    ai_interaction_log: Optional[str] = None  # JSON string of AI interactions

    @field_validator("contribution_type")
    @classmethod
    def validate_contribution_type(cls, v: str) -> str:
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(
                f"contribution_type must be one of {allowed}, got '{v}'"
            )
        return v

    @field_validator("pertinence")
    @classmethod
    def validate_pertinence(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("pertinence must be between 0.0 and 1.0")
        return v

    @model_validator(mode="after")
    def validate_contribution_type_detail(self):
        if self.contribution_type == "others" and not self.contribution_type_detail:
            raise ValueError(
                "contribution_type_detail is required when contribution_type is 'others'"
            )
        return self


class KnowledgeItemUpdate(BaseModel):
    raw_ideal_response: Optional[str] = None
    window_start_turn_number: Optional[int] = None
    window_end_turn_number: Optional[int] = None
    best_turn_number: Optional[int] = None
    contribution_type: Optional[str] = None
    contribution_type_detail: Optional[str] = None
    pertinence: Optional[float] = None
    notes: Optional[str] = None
    inserted_resources: Optional[str] = None
    ai_interaction_log: Optional[str] = None

    @field_validator("contribution_type")
    @classmethod
    def validate_contribution_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(
                f"contribution_type must be one of {allowed}, got '{v}'"
            )
        return v

    @field_validator("pertinence")
    @classmethod
    def validate_pertinence(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if not 0.0 <= v <= 1.0:
            raise ValueError("pertinence must be between 0.0 and 1.0")
        return v


class KnowledgeItemOut(BaseModel):
    id: str
    conversation_id: str
    author_id: str
    raw_ideal_response: str
    neutralized_ideal_response: Optional[str] = None
    ai_suggestion_used: bool
    window_start_turn_number: int
    window_end_turn_number: int
    best_turn_number: int
    contribution_type: str
    contribution_type_detail: Optional[str] = None
    pertinence: float
    notes: Optional[str] = None
    inserted_resources: Optional[str] = None
    ai_interaction_log: Optional[str] = None
    source: str
    review_status: str
    created_at: datetime


class SearchQuery(BaseModel):
    query: str


class SearchResultOut(BaseModel):
    id: str
    query: str
    result_title: str
    result_snippet: Optional[str] = None
    result_url: Optional[str] = None
    result_metadata: Optional[dict] = None


class InsertedResource(BaseModel):
    """A resource that the user has selected to include in their knowledge item."""
    id: str
    title: str
    snippet: Optional[str] = None
    url: Optional[str] = None
    source: str  # "scholar" or "web"


class AISuggestRequest(BaseModel):
    contribution_type: str
    importance: float
    window_start: int
    window_end: int
    best_turn: int
    inserted_resources: Optional[List[InsertedResource]] = None
    existing_text: Optional[str] = None
    mode: str = "refine"  # "refine" or "polish"

    @field_validator("contribution_type")
    @classmethod
    def validate_contribution_type(cls, v: str) -> str:
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(
                f"contribution_type must be one of {allowed}, got '{v}'"
            )
        return v

    @field_validator("importance")
    @classmethod
    def validate_importance(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("importance must be between 0.0 and 1.0")
        return v

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in ("refine", "polish"):
            raise ValueError("mode must be 'refine' or 'polish'")
        return v


class AISuggestResponse(BaseModel):
    suggestion: str


class AIIntentionsRequest(BaseModel):
    window_start: int
    window_end: int
    best_turn: int


class IntentionTag(BaseModel):
    tag: str
    category: str

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(f"category must be one of {allowed}")
        return v


class AISourceSearchRequest(BaseModel):
    window_start: int
    window_end: int
    best_turn: int
    intention_tag: str
    contribution_type: str

    @field_validator("contribution_type")
    @classmethod
    def validate_contribution_type(cls, v: str) -> str:
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(
                f"contribution_type must be one of {allowed}, got '{v}'"
            )
        return v


class AISourceSearchResponse(BaseModel):
    queries_used: List[str]
    results: List[SearchResultOut]


class AIGenerateMessageRequest(BaseModel):
    window_start: int
    window_end: int
    best_turn: int
    intention_tag: str
    contribution_type: str
    pertinence: float
    inserted_resources: Optional[List[InsertedResource]] = None
    follow_up_prompt: Optional[str] = None
    previous_messages: Optional[List[dict]] = None

    @field_validator("contribution_type")
    @classmethod
    def validate_contribution_type(cls, v: str) -> str:
        allowed = {"heads_up", "pushback", "support", "suggestion", "others"}
        if v not in allowed:
            raise ValueError(
                f"contribution_type must be one of {allowed}, got '{v}'"
            )
        return v

    @field_validator("pertinence")
    @classmethod
    def validate_pertinence(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("pertinence must be between 0.0 and 1.0")
        return v


class AIGenerateMessageResponse(BaseModel):
    message: str


class NextItemSuggestion(BaseModel):
    direction: str
    category: str
    start_turn: int
    end_turn: int
    best_turn: int
    detail: str


class NextItemSuggestionsResponse(BaseModel):
    suggestions: List[NextItemSuggestion]
