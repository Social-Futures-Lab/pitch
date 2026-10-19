import enum


class UserRole(str, enum.Enum):
    participant = "participant"
    external_annotator = "external_annotator"
    researcher = "researcher"


class Scenario(str, enum.Enum):
    scholar = "scholar"
    trip = "trip"


class GroupStatus(str, enum.Enum):
    conversation = "conversation"
    construction = "construction"
    neutralization = "neutralization"
    cross_annotation = "cross_annotation"
    deliberation = "deliberation"
    complete = "complete"


class ContributionType(str, enum.Enum):
    heads_up = "heads_up"
    pushback = "pushback"
    support = "support"
    suggestion = "suggestion"
    others = "others"


class ItemSource(str, enum.Enum):
    participant = "participant"
    llm_generated = "llm_generated"
    researcher_authored = "researcher_authored"


class ReviewStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class AnnotatorRole(str, enum.Enum):
    author = "author"
    within_group = "within_group"
    external = "external"


class AnnotationPhase(str, enum.Enum):
    cross_annotation = "cross_annotation"
    deliberation = "deliberation"


class AttentionCheckType(str, enum.Enum):
    irrelevant = "irrelevant"
    unambiguous_placement = "unambiguous_placement"


class ConsensusStatus(str, enum.Enum):
    well_defined = "well_defined"
    contested = "contested"
    do_not_surface = "do_not_surface"


class ConsensusMethod(str, enum.Enum):
    borda_count = "borda_count"
