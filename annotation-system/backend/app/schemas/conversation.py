from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ConversationCreate(BaseModel):
    group_id: str


class ConversationOut(BaseModel):
    id: str
    group_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class TurnOut(BaseModel):
    id: str
    conversation_id: str
    turn_number: int
    speaker_id: str
    speaker_name: str
    text: str
    timestamp: datetime
    model_config = {"from_attributes": True}


class TurnCreate(BaseModel):
    text: str


class FlagCreate(BaseModel):
    turn_id: str


class FlagOut(BaseModel):
    id: str
    turn_id: str
    timestamp: datetime
    model_config = {"from_attributes": True}


class ConversationDetail(BaseModel):
    id: str
    group_id: str
    topic: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    turns: List[TurnOut] = []
    model_config = {"from_attributes": True}
