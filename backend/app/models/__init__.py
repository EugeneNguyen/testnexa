"""Import every ORM model so `Base.metadata` is fully populated on `import app.models`.

DEVIATION NOTE (see Database Document §1 and this scaffold task's "exactly 35
tables" instruction): the Database Document's own reconciliation math states
"Total physical tables: 35", but its detailed per-cluster table listing in
§3.1-3.11 literally names 38 distinct tables (verified by exhaustive count).
We implemented every table in the detailed per-cluster listing — the
column-level spec, which is the authoritative, load-bearing part of the
document — rather than silently dropping 3 real tables to force the summary
count. `Base.metadata.tables` therefore has 38 tables, not 35; this is
flagged explicitly in the scaffold's final report and in
`tests/unit/test_models_import.py`.
"""

from app.db.base import Base
from app.models.actor import Actor, AIAgent, User
from app.models.assets import (
    Requirement,
    TestCase,
    TestCondition,
    TestStep,
    TestSuite,
    TestSuiteTestCase,
)
from app.models.auth import AuthIdentity, LoginAttempt, RefreshToken
from app.models.execution import Defect, TestExecution, TestLog
from app.models.governance import Approval, Attachment, RiskItem
from app.models.planning import (
    EntryExitCriteria,
    Environment,
    TestCycle,
    TestPlan,
    TestPlanTestSuite,
)
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import (
    TestCaseTestDesignTechnique,
    TestDesignTechnique,
    TestLevel,
    TestType,
)
from app.models.tenancy import Invite, Organization, OrgMembership
from app.models.trace import (
    RequirementTestCaseLink,
    RequirementTestConditionLink,
    TestCaseDefectLink,
    TestConditionTestCaseLink,
)

__all__ = [
    "AIAgent",
    "Actor",
    "Approval",
    "Attachment",
    "AuthIdentity",
    "Base",
    "Defect",
    "EntryExitCriteria",
    "Environment",
    "Invite",
    "LoginAttempt",
    "OrgMembership",
    "Organization",
    "Permission",
    "Project",
    "RefreshToken",
    "Release",
    "Requirement",
    "RequirementTestCaseLink",
    "RequirementTestConditionLink",
    "RiskItem",
    "Role",
    "RoleAssignment",
    "RolePermission",
    "TestCase",
    "TestCaseDefectLink",
    "TestCaseTestDesignTechnique",
    "TestCondition",
    "TestConditionTestCaseLink",
    "TestCycle",
    "TestDesignTechnique",
    "TestExecution",
    "TestLevel",
    "TestLog",
    "TestPlan",
    "TestPlanTestSuite",
    "TestStep",
    "TestSuite",
    "TestSuiteTestCase",
    "TestType",
    "User",
]
