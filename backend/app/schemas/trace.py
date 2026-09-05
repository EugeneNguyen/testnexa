"""Pydantic v2 schemas for the ADR-0025 generic-CRUD factory's traceability
link-table routes.

Source: API Document §5 (read-only routes), Database Document §3.9 (the 4
dedicated link tables, ADR-0005). Every link table is `list`/`get` only —
`.read` is the only permission code seeded for any of them
(`app/db/rbac_seed_catalog.py`'s `READ_ONLY_RESOURCES`) — so, matching
`app/schemas/rbac.py`'s `Permission` precedent, there is no `Create`/`Update`
request schema here at all; `app/api/crud_factory.NoSchema` stands in for
`update_schema` on every one of these configs.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RequirementTestCaseLinkSummary(BaseModel):
    id: UUID
    requirement_id: UUID
    test_case_id: UUID
    created_at: datetime


class RequirementTestCaseLinkListResponse(BaseModel):
    items: list[RequirementTestCaseLinkSummary]
    total: int
    page: int
    page_size: int


class RequirementTestConditionLinkSummary(BaseModel):
    id: UUID
    requirement_id: UUID
    test_condition_id: UUID
    created_at: datetime


class RequirementTestConditionLinkListResponse(BaseModel):
    items: list[RequirementTestConditionLinkSummary]
    total: int
    page: int
    page_size: int


class TestConditionTestCaseLinkSummary(BaseModel):
    id: UUID
    test_condition_id: UUID
    test_case_id: UUID
    created_at: datetime


class TestConditionTestCaseLinkListResponse(BaseModel):
    items: list[TestConditionTestCaseLinkSummary]
    total: int
    page: int
    page_size: int


class TestCaseDefectLinkSummary(BaseModel):
    id: UUID
    test_case_id: UUID
    defect_id: UUID
    created_at: datetime


class TestCaseDefectLinkListResponse(BaseModel):
    items: list[TestCaseDefectLinkSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "RequirementTestCaseLinkListResponse",
    "RequirementTestCaseLinkSummary",
    "RequirementTestConditionLinkListResponse",
    "RequirementTestConditionLinkSummary",
    "TestCaseDefectLinkListResponse",
    "TestCaseDefectLinkSummary",
    "TestConditionTestCaseLinkListResponse",
    "TestConditionTestCaseLinkSummary",
]
