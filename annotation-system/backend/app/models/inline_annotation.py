import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class InlineAnnotation(Base):
    __tablename__ = "inline_annotations"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    turn_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turns.id"), nullable=False
    )
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="inline_annotations"
    )
    turn: Mapped["Turn"] = relationship("Turn")
    participant: Mapped["User"] = relationship(
        "User", back_populates="inline_annotations"
    )
