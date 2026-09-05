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

from app.api.crud_factory import CrudEntityConfig, make_crud_router, resolve_risk_item_org_id, resolve_via_test_case
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
    filter_fields=("likelihood", "impact"),
)

_ATTACHMENT_CONFIG = CrudEntityConfig(
    model=Attachment,
    resource="attachment",
    create_schema=CreateAttachmentRequest,
    update_schema=UpdateAttachmentRequest,
    summary_schema=AttachmentSummary,
    scope_field="test_case_id",
    resolve_org_id=resolve_via_test_case,
)

router.include_router(make_crud_router(_RISK_ITEM_CONFIG))
router.include_router(make_crud_router(_ATTACHMENT_CONFIG))

__all__ = ["router"]
