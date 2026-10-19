import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TranscriptExcerpt(Base):
    __tablename__ = "transcript_excerpts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    knowledge_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_items.id"), nullable=False
    )
    start_turn_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    end_turn_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    preceding_context_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    following_context_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="transcript_excerpts"
    )
    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem")
    start_turn: Mapped["Turn"] = relationship("Turn", foreign_keys=[start_turn_id])
    end_turn: Mapped["Turn"] = relationship("Turn", foreign_keys=[end_turn_id])
