"""Pydantic v2 schemas for the API-1 generic-CRUD factory's governance cluster.

Source: API Document §3 (generic CRUD routes, ADR-0021), Database Document
§3.11 (`RiskItem`/`Attachment`). `Approval` is deliberately excluded — no
`create`/`update`/`delete` beyond FR-GOV-1's bespoke `/test-plans/{id}/approve`
exists in `CRUD_RESOURCES`'s API surface, no AC asks for generic `Approval`
CRUD (ADR-0021/plan).

**Deviation from ADR-0021's literal text, flagged here and in the story's
final report:** the ADR says `RiskItem`'s "both `requirement_id` and
`test_plan_id` set" case is "rejected at the schema-validation layer" via "a
Pydantic validator". `CreateRiskItemRequest` below has no such validator —
the "exactly one of `requirement_id`/`test_plan_id`" rule is instead enforced
by `app/api/crud_factory.py`'s own generic scope-resolution logic
(`extract_scope_value`/`scope_validation_error`), which `RiskItem`'s
`scope_field = ("requirement_id", "test_plan_id")` (a 2-tuple) already drives
for `list`'s equivalent "exactly one" requirement. Reusing that single,
already-tested code path for `create` too produces the *exact* documented
`422` shape (`{"requirement_id": ["exactly one of requirement_id or
test_plan_id must be set, not both"]}`) without a second, parallel
enforcement mechanism — a Pydantic `model_validator` raising inside a
request-body model surfaces via FastAPI's `RequestValidationError`, whose
default `loc` for a whole-model validator error is the model path itself,
not a specific field, so hitting the exact documented per-field shape would
have required either a bespoke `RequestValidationError` handler keyed to this
one case or accepting a non-conforming error body. Net behavior (`422`, same
message, same field key) is identical either way; only the enforcement layer
moved.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

RiskLevel = Literal["low", "medium", "high"]


# --- RiskItem --------------------------------------------------------------------------------


class CreateRiskItemRequest(BaseModel):
    """Body of `POST /risk-items` — exactly one of `requirement_id`/`test_plan_id`
    is the required scope field (see module docstring for where "exactly
    one" is enforced).
    """

    requirement_id: UUID | None = None
    test_plan_id: UUID | None = None
    description: str
    likelihood: RiskLevel
    impact: RiskLevel
    mitigation: str | None = None


class UpdateRiskItemRequest(BaseModel):
    """`requirement_id`/`test_plan_id` are not reassignable through this route
    (no defined resolver behavior for reassignment, ADR-0021).
    """

    description: str | None = None
    likelihood: RiskLevel | None = None
    impact: RiskLevel | None = None
    mitigation: str | None = None


class RiskItemSummary(BaseModel):
    id: UUID
    requirement_id: UUID | None = None
    test_plan_id: UUID | None = None
    description: str
    likelihood: RiskLevel
    impact: RiskLevel
    mitigation: str | None = None


class RiskItemListResponse(BaseModel):
    items: list[RiskItemSummary]
    total: int
    page: int
    page_size: int


# --- Attachment ------------------------------------------------------------------------------


class CreateAttachmentRequest(BaseModel):
    """Body of `POST /attachments` — `test_case_id` is the required scope field.

    Metadata-only (ADR-0021 edge case #2): `url_or_path`/`mime_type`/
    `size_bytes` are supplied directly by the caller for an already-uploaded
    file — no multipart file-upload handling in this factory (`ATTACHMENT_STORAGE`
    upload/storage-backend wiring is GOV-3's own separate, not-yet-built
    concern).
    """

    test_case_id: UUID
    url_or_path: str
    mime_type: str
    size_bytes: int


class UpdateAttachmentRequest(BaseModel):
    url_or_path: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None


class AttachmentSummary(BaseModel):
    id: UUID
    test_case_id: UUID
    url_or_path: str
    mime_type: str
    size_bytes: int


class AttachmentListResponse(BaseModel):
    items: list[AttachmentSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "AttachmentListResponse",
    "AttachmentSummary",
    "CreateAttachmentRequest",
    "CreateRiskItemRequest",
    "RiskItemListResponse",
    "RiskItemSummary",
    "RiskLevel",
    "UpdateAttachmentRequest",
    "UpdateRiskItemRequest",
]
