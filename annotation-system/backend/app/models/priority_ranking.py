import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey, String
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import AnnotationPhase


class PriorityRanking(Base):
    __tablename__ = "priority_rankings"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    excerpt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transcript_excerpts.id"), nullable=False
    )
    annotator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    phase: Mapped[AnnotationPhase] = mapped_column(String(50), nullable=False)
    ranked_items: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    excerpt: Mapped["TranscriptExcerpt"] = relationship("TranscriptExcerpt")
    annotator: Mapped["User"] = relationship(
        "User", back_populates="priority_rankings"
    )
