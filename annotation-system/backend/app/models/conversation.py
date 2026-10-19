import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("groups.id"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Relationships
    group: Mapped["Group"] = relationship("Group", back_populates="conversations")
    turns: Mapped[list["Turn"]] = relationship("Turn", back_populates="conversation")
    inline_annotations: Mapped[list["InlineAnnotation"]] = relationship(
        "InlineAnnotation", back_populates="conversation"
    )
    knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(
        "KnowledgeItem", back_populates="conversation"
    )
    transcript_excerpts: Mapped[list["TranscriptExcerpt"]] = relationship(
        "TranscriptExcerpt", back_populates="conversation"
    )
