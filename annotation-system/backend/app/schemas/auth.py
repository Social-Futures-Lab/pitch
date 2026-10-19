from pydantic import BaseModel
from typing import Optional


class ResearcherLogin(BaseModel):
    email: str
    password: str


class ParticipantLogin(BaseModel):
    name: str
    join_code: str


class ExternalAnnotatorLogin(BaseModel):
    prolific_id: str


class UserOut(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    role: str

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
