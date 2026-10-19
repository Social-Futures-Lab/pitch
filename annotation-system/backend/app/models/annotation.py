import uuid
from datetime import datetime

from sqlalchemy import func, Boolean, Float, ForeignKey, String, Text
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import AnnotationPhase, AnnotatorRole


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    excerpt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transcript_excerpts.id"), nullable=False
    )
    knowledge_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_items.id"), nullable=False
    )
    annotator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    annotator_role: Mapped[AnnotatorRole] = mapped_column(String(50), nullable=False)
    phase: Mapped[AnnotationPhase] = mapped_column(String(50), nullable=False)
    window_start_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    window_end_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    best_turn_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    do_not_surface: Mapped[bool] = mapped_column(Boolean, default=False)
    extends_before: Mapped[bool] = mapped_column(Boolean, default=False)
    extends_after: Mapped[bool] = mapped_column(Boolean, default=False)
    contribution_type: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )
    contribution_type_detail: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    pertinence: Mapped[float | None] = mapped_column(Float, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    visible_peer_annotations: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )
    revision_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("annotations.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    excerpt: Mapped["TranscriptExcerpt"] = relationship("TranscriptExcerpt")
    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem")
    annotator: Mapped["User"] = relationship("User", back_populates="annotations")
    window_start: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[window_start_id]
    )
    window_end: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[window_end_id]
    )
    best_turn: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[best_turn_id]
    )
    revision_of: Mapped["Annotation | None"] = relationship(
        "Annotation", remote_side=[id], foreign_keys=[revision_of_id]
    )
