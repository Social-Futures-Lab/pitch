from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def enum_val(v):
    """Safely get the string value from an enum or a plain string."""
    return v.value if hasattr(v, "value") else v
