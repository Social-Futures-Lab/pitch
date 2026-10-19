import uuid
from datetime import datetime

from sqlalchemy import func, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    role: Mapped[UserRole] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    prolific_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    group_memberships: Mapped[list["GroupMembership"]] = relationship(
        "GroupMembership", back_populates="user"
    )
    turns: Mapped[list["Turn"]] = relationship("Turn", back_populates="speaker")
    inline_annotations: Mapped[list["InlineAnnotation"]] = relationship(
        "InlineAnnotation", back_populates="participant"
    )
    knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(
        "KnowledgeItem", back_populates="author"
    )
    annotations: Mapped[list["Annotation"]] = relationship(
        "Annotation", back_populates="annotator"
    )
    priority_rankings: Mapped[list["PriorityRanking"]] = relationship(
        "PriorityRanking", back_populates="annotator"
    )
    qualification_results: Mapped[list["QualificationResult"]] = relationship(
        "QualificationResult", back_populates="annotator"
    )
