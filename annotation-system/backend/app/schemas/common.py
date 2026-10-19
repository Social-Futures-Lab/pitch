from pydantic import BaseModel
from typing import Optional, Any


class MessageResponse(BaseModel):
    message: str
    detail: Optional[Any] = None
