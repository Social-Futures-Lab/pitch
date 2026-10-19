import uuid
from datetime import datetime

from sqlalchemy import func, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import GroupStatus, Scenario


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    scenario: Mapped[Scenario] = mapped_column(String(50), nullable=False)
    prompt_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("discussion_prompts.id"), nullable=True
    )
    status: Mapped[GroupStatus] = mapped_column(
        String(50), default=GroupStatus.conversation,
    )
    join_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    prompt: Mapped["DiscussionPrompt | None"] = relationship(
        "DiscussionPrompt", back_populates="groups"
    )
    members: Mapped[list["GroupMembership"]] = relationship(
        "GroupMembership", back_populates="group"
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        "Conversation", back_populates="group"
    )


class GroupMembership(Base):
    __tablename__ = "group_memberships"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_membership"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("groups.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    joined_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )
    construction_done_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    annotation_done_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    deliberation_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    ranking_deliberation_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )

    # Relationships
    group: Mapped["Group"] = relationship("Group", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="group_memberships")
