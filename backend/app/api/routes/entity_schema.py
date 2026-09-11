"""ADR-0053: `GET /entities/{resource}/schema` — one route serving every
admin-CRUD entity's field shape (`crud_factory.derive_entity_schema`),
replacing the frontend's static `entityConfigs/<entity>.ts` imports.

No permission gate beyond "must be a logged-in actor" (`get_current_actor`)
— unlike every other route in this codebase, a field *shape* carries no
tenant-scoped row data of its own to leak; the entity's own list/create/
update/delete routes still gate real rows normally, unchanged by this ADR.
`resource` is the plural `:entity` route slug (`entity_registry`'s own
dict keys), matching every other admin route's `:entity` param convention.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.crud_factory import derive_entity_schema
from app.api.deps import get_current_actor
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.models.actor import AIAgent, User

router = APIRouter()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": None})


@router.get("/entities/{resource}/schema", response_model=None)
async def get_entity_schema(resource: str, actor: User | AIAgent = Depends(get_current_actor)) -> dict | JSONResponse:
    config = ALL_ENTITY_CONFIGS.get(resource)
    if config is None:
        return _error(404, "not_found", f'Unknown entity "{resource}".')
    return derive_entity_schema(config)
