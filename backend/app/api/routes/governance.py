"""API-1: generic-CRUD factory routes for the governance cluster (ADR-0022).

`RiskItem`/`Attachment` get all 5 methods. `Approval` is excluded entirely
(`app/schemas/governance.py`'s module docstring).

`RiskItem`'s `scope_field` is a 2-tuple (`requirement_id`, `test_plan_id`) —
`app/api/crud_factory.py`'s scope-resolution machinery requires exactly one
present on both `list` and `create`, matching its `CHECK` constraint's `OR`
narrowed to an API-level `XOR` (ADR-0022 edge case #5; see
`app/schemas/governance.py`'s module docstring for the enforcement-layer
deviation this implements it at). `Attachment` delegates to `TestCase`'s
resolver one hop up, same as `TestStep`.
"""

from fastapi import APIRouter

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    ScopeSelectorOption,
    make_crud_router,
    resolve_risk_item_org_id,
    resolve_via_test_case,
)
from app.models.governance import Attachment, RiskItem
from app.schemas.governance import (
    AttachmentSummary,
    CreateAttachmentRequest,
    CreateRiskItemRequest,
    RiskItemSummary,
    UpdateAttachmentRequest,
    UpdateRiskItemRequest,
)

router = APIRouter()

_RISK_ITEM_CONFIG = CrudEntityConfig(
    model=RiskItem,
    resource="risk_item",
    create_schema=CreateRiskItemRequest,
    update_schema=UpdateRiskItemRequest,
    summary_schema=RiskItemSummary,
    scope_field=("requirement_id", "test_plan_id"),
    resolve_org_id=resolve_risk_item_org_id,
    # ADR-0070. `likelihood`/`impact` are enums, exact-matchable via
    # ADR-0072's derived filter set (the explicit `filter_fields` tuple that
    # used to sit here is gone).
    search_fields=("description", "mitigation"),
    # ADR-0053
    label="Risk items",
    scope_selector=(
        ScopeSelectorOption(
            ref_entity="requirement", param_name="requirement_id", label_field="description", label="By requirement", select=True
        ),
        ScopeSelectorOption(ref_entity="test-plan", param_name="test_plan_id", label_field="identifier", label="By test plan", select=True),
    ),
    field_meta={
        "requirement_id": FieldMeta(
            ref_entity="requirement", label_field="description", label="Requirement", select=True
        ),
        "test_plan_id": FieldMeta(ref_entity="test-plan", label_field="identifier", label="Test plan"),
        "mitigation": FieldMeta(show_in_table=False),
    },
)

_ATTACHMENT_CONFIG = CrudEntityConfig(
    model=Attachment,
    resource="attachment",
    create_schema=CreateAttachmentRequest,
    update_schema=UpdateAttachmentRequest,
    summary_schema=AttachmentSummary,
    scope_field="test_case_id",
    resolve_org_id=resolve_via_test_case,
    # ADR-0070. `size_bytes` is deliberately NOT listed even though it is a
    # numeric column `_search_clause` could now handle: a byte count is a
    # measurement, not an identifier, and substring-matching its digits
    # ("1024" matching 10240) answers no question a user actually asks.
    # `TestStep.sequence` is the numeric case that IS meaningful.
    search_fields=("url_or_path", "mime_type"),
    # ADR-0053
    label="Attachments",
    scope_selector=ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label_field="title", select=True),
    field_meta={
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case", select=True),
        "url_or_path": FieldMeta(label="URL / path"),
        "mime_type": FieldMeta(label="MIME type"),
        "size_bytes": FieldMeta(label="Size (bytes)"),
    },
)

router.include_router(make_crud_router(_RISK_ITEM_CONFIG))
router.include_router(make_crud_router(_ATTACHMENT_CONFIG))

__all__ = ["router"]
