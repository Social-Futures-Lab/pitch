import uuid
from datetime import datetime

from sqlalchemy import func, Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ContributionType, ItemSource, ReviewStatus


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    raw_ideal_response: Mapped[str] = mapped_column(Text, nullable=False)
    neutralized_ideal_response: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    ai_suggestion_used: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_suggestion_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    window_start_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    window_end_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    best_turn_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    contribution_type: Mapped[ContributionType] = mapped_column(String(50), nullable=False)
    contribution_type_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pertinence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[ItemSource] = mapped_column(String(50), default=ItemSource.participant)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    inserted_resources: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_interaction_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[ReviewStatus] = mapped_column(String(50), default=ReviewStatus.pending)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="knowledge_items"
    )
    author: Mapped["User"] = relationship("User", back_populates="knowledge_items")
    window_start: Mapped["Turn"] = relationship("Turn", foreign_keys=[window_start_id])
    window_end: Mapped["Turn"] = relationship("Turn", foreign_keys=[window_end_id])
    best_turn: Mapped["Turn"] = relationship("Turn", foreign_keys=[best_turn_id])
    search_results: Mapped[list["SearchResult"]] = relationship(
        "SearchResult", back_populates="knowledge_item"
    )
