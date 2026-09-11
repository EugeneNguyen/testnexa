"""ADR-0053: collects every `CrudEntityConfig` instance scattered across the
7 route-cluster modules into one lookup, keyed by the same plural `:entity`
route slug the frontend has always used (`crud_factory._resource_path`) —
nothing in this codebase had a single collected index of every entity
config before this; `make_crud_router(config)` is called once per config,
per cluster module, with no shared registry behind it.

Backs `GET /entities/{resource}/schema` (`app/api/routes/entity_schema.py`).

**`Release` is deliberately absent** — its create/list are 100% bespoke (no
`CrudEntityConfig` at all, ADR-0027's own "Release... 100% bespoke" note),
so there is nothing here for this registry to collect. Its frontend
`entityConfigs/release.ts` stays static, outside this ADR's scope.
"""

from app.api.crud_factory import CrudEntityConfig, _resource_path
from app.api.routes.assets import (
    _REQUIREMENT_CONFIG,
    _TEST_CASE_CONFIG,
    _TEST_CONDITION_CONFIG,
    _TEST_STEP_CONFIG,
    _TEST_SUITE_CONFIG,
)
from app.api.routes.execution import _DEFECT_CONFIG, _TEST_EXECUTION_CONFIG, _TEST_LOG_CONFIG
from app.api.routes.governance import _ATTACHMENT_CONFIG, _RISK_ITEM_CONFIG
from app.api.routes.org_memberships import _ORG_MEMBERSHIP_CONFIG
from app.api.routes.organizations import _ORGANIZATION_CONFIG
from app.api.routes.planning import (
    _ENTRY_EXIT_CRITERIA_CONFIG,
    _ENVIRONMENT_CONFIG,
    _TEST_CYCLE_CONFIG,
    _TEST_PLAN_CONFIG,
)
from app.api.routes.projects import _PROJECT_FACTORY_CONFIG
from app.api.routes.rbac_routes import _PERMISSION_CONFIG, _ROLE_ASSIGNMENT_CONFIG, _ROLE_CONFIG
from app.api.routes.taxonomy import _TEST_DESIGN_TECHNIQUE_CONFIG, _TEST_LEVEL_CONFIG, _TEST_TYPE_CONFIG
from app.api.routes.trace import (
    _REQUIREMENT_TEST_CASE_LINK_CONFIG,
    _REQUIREMENT_TEST_CONDITION_LINK_CONFIG,
    _TEST_CASE_DEFECT_LINK_CONFIG,
    _TEST_CONDITION_TEST_CASE_LINK_CONFIG,
)

_ALL_CONFIGS: tuple[CrudEntityConfig, ...] = (
    _REQUIREMENT_CONFIG,
    _TEST_CONDITION_CONFIG,
    _TEST_CASE_CONFIG,
    _TEST_STEP_CONFIG,
    _TEST_SUITE_CONFIG,
    _RISK_ITEM_CONFIG,
    _ATTACHMENT_CONFIG,
    _DEFECT_CONFIG,
    _TEST_EXECUTION_CONFIG,
    _TEST_LOG_CONFIG,
    _ORGANIZATION_CONFIG,
    _TEST_PLAN_CONFIG,
    _ENTRY_EXIT_CRITERIA_CONFIG,
    _ENVIRONMENT_CONFIG,
    _TEST_CYCLE_CONFIG,
    _PROJECT_FACTORY_CONFIG,
    _ORG_MEMBERSHIP_CONFIG,
    _ROLE_CONFIG,
    _PERMISSION_CONFIG,
    _ROLE_ASSIGNMENT_CONFIG,
    _TEST_DESIGN_TECHNIQUE_CONFIG,
    _TEST_LEVEL_CONFIG,
    _TEST_TYPE_CONFIG,
    _REQUIREMENT_TEST_CASE_LINK_CONFIG,
    _REQUIREMENT_TEST_CONDITION_LINK_CONFIG,
    _TEST_CONDITION_TEST_CASE_LINK_CONFIG,
    _TEST_CASE_DEFECT_LINK_CONFIG,
)

ALL_ENTITY_CONFIGS: dict[str, CrudEntityConfig] = {_resource_path(config.resource): config for config in _ALL_CONFIGS}
