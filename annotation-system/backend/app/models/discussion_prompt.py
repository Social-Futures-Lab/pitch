import uuid
from datetime import datetime

from sqlalchemy import func, String, Text as SAText
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Scenario


class DiscussionPrompt(Base):
    __tablename__ = "discussion_prompts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    scenario: Mapped[Scenario] = mapped_column(String(50), nullable=False)
    text: Mapped[str] = mapped_column(SAText, nullable=False)
    pre_identified_items: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    groups: Mapped[list["Group"]] = relationship("Group", back_populates="prompt")
