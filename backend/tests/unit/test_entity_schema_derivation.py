"""Unit tests for ADR-0053's entity-schema derivation in `app/api/crud_factory.py`.

Pure in-process tests: no DB, no live server, no network — same posture as
`tests/unit/test_crud_factory.py` (this module's sibling, which covers the
resolver/filter/pagination half of the same file). `derive_entity_schema` is
pure branching logic over Pydantic's own `model_fields` plus a
`CrudEntityConfig`'s declared overrides, so it needs neither.

**Everything under test here is exercised against SYNTHETIC schemas and
synthetic `CrudEntityConfig`s defined in this file, never the 27 real
entities.** That's deliberate: the derived shape of each *real* entity is a
data question (does `Requirement`'s config declare the right `field_meta`?)
covered by the integration layer against the live `GET
/entities/{resource}/schema` route. What's covered here is the *derivation
rule* — given these inputs, this output — which is what actually breaks
silently when someone edits the function.

Two behaviours get disproportionate attention because their regression modes
are silent rather than loud:

1. `field_order` is **order-only, never a filter** (`CrudEntityConfig.field_order`'s
   own docstring). A field nobody remembered to name in it must still appear,
   appended in derived order — letting it double as the field list would
   reintroduce exactly the `Requirement.title` drift ADR-0053 exists to close.
2. Enum `badgeColors` defaults to the module's shared `ENUM_BADGE_COLORS`, is
   **filtered to that field's own declared `Literal` values** (so a field never
   advertises a colour for a value it cannot hold), is overridable per-field
   via `FieldMeta.badge_colors`, and is **omitted entirely** when nothing
   matches (which is how the frontend's plain-grey default stays in play).
"""

import datetime
import uuid
from typing import Any, Literal, Optional

import pytest
from pydantic import BaseModel

from app.api.crud_factory import (
    ENUM_BADGE_COLORS,
    CrudEntityConfig,
    FieldMeta,
    NoSchema,
    ScopeResolution,
    ScopeSelectorOption,
    _field_type_and_values,
    chain_resolver,
    derive_entity_schema,
)
from app.models.assets import Requirement

# --- synthetic schemas ----------------------------------------------------------------------------
#
# One deliberately over-shaped entity ("widget") whose three schemas overlap
# partially, so the create-union-update-union-summary rule has something real
# to prove: `owner_id` exists only on update, `created_at`/`is_archived` only
# on summary, `description` on both writable schemas, `id` only on summary
# (and must be dropped).


class _WidgetCreate(BaseModel):
    name: str
    status: Literal["draft", "active", "deprecated"]
    project_id: uuid.UUID
    description: str | None = None


class _WidgetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    owner_id: uuid.UUID | None = None


class _WidgetSummary(BaseModel):
    id: uuid.UUID
    name: str
    status: Literal["draft", "active", "deprecated"]
    project_id: uuid.UUID
    created_at: datetime.datetime
    is_archived: bool


class _IdOnlySummary(BaseModel):
    id: uuid.UUID


class _RequiredOnUpdate(BaseModel):
    """A schema with a genuinely REQUIRED field, used as `update_schema` only —
    proves `required` is sourced from `create_schema` alone."""

    title: str


class _TypesProbe(BaseModel):
    """One field per branch of `_field_type_and_values`, all as `create_schema`
    fields so none of them is `readOnly`."""

    plain_str: str
    an_int: int
    a_uuid: uuid.UUID
    an_optional_uuid: uuid.UUID | None = None
    a_date: datetime.date
    a_datetime: datetime.datetime
    an_optional_datetime: Optional[datetime.datetime] = None
    a_bool: bool
    an_optional_bool: bool | None = None
    a_literal: Literal["draft", "active"]
    an_optional_literal: Literal["draft", "active"] | None = None
    a_payload: dict[str, Any] | None = None


# --- helpers --------------------------------------------------------------------------------------


def _config(**overrides: Any) -> CrudEntityConfig:
    """A minimal, valid `CrudEntityConfig` — every test overrides only the
    keys it actually cares about (mirrors `test_crud_factory.py`'s own
    `_config` helper convention)."""
    defaults: dict[str, Any] = dict(
        model=Requirement,
        resource="widget",
        create_schema=None,
        update_schema=NoSchema,
        summary_schema=_IdOnlySummary,
        scope_field="project_id",
        resolve_org_id=chain_resolver([]),
    )
    defaults.update(overrides)
    return CrudEntityConfig(**defaults)


def _widget_config(**overrides: Any) -> CrudEntityConfig:
    """The full three-schema "widget" entity above."""
    return _config(
        create_schema=_WidgetCreate,
        update_schema=_WidgetUpdate,
        summary_schema=_WidgetSummary,
        **overrides,
    )


def _fields(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {entry["name"]: entry for entry in schema["fields"]}


def _names(schema: dict[str, Any]) -> list[str]:
    return [entry["name"] for entry in schema["fields"]]


# --- _field_type_and_values -----------------------------------------------------------------------


class TestFieldTypeAndValues:
    @pytest.mark.parametrize(
        ("annotation", "expected_type"),
        [
            (str, "string"),
            (int, "string"),
            (float, "string"),
            (dict[str, Any], "string"),
            (list[str], "string"),
            (datetime.date, "date"),
            (datetime.datetime, "date"),
            (bool, "boolean"),
        ],
    )
    def test_scalar_annotations(self, annotation: Any, expected_type: str) -> None:
        assert _field_type_and_values(annotation) == (expected_type, None)

    def test_uuid_maps_to_string_not_fk(self) -> None:
        # ADR-0053: nothing about the Python type says "this UUID is a foreign
        # key," let alone which entity it targets — only a `FieldMeta.ref_entity`
        # entry promotes it (see `TestForeignKeyOverrides` below).
        assert _field_type_and_values(uuid.UUID) == ("string", None)

    def test_literal_returns_enum_and_its_values(self) -> None:
        assert _field_type_and_values(Literal["draft", "active", "deprecated"]) == (
            "enum",
            ["draft", "active", "deprecated"],
        )

    def test_literal_values_are_stringified(self) -> None:
        assert _field_type_and_values(Literal[1, 2]) == ("enum", ["1", "2"])

    def test_literal_value_order_is_declaration_order(self) -> None:
        assert _field_type_and_values(Literal["c", "a", "b"])[1] == ["c", "a", "b"]

    @pytest.mark.parametrize(
        ("annotation", "expected"),
        [
            (uuid.UUID | None, ("string", None)),
            (Optional[uuid.UUID], ("string", None)),
            (str | None, ("string", None)),
            (bool | None, ("boolean", None)),
            (datetime.date | None, ("date", None)),
            (Optional[datetime.datetime], ("date", None)),
        ],
    )
    def test_optional_wrapper_is_unwrapped(self, annotation: Any, expected: tuple[str, Any]) -> None:
        assert _field_type_and_values(annotation) == expected

    def test_optional_literal_is_unwrapped_to_enum_with_values(self) -> None:
        assert _field_type_and_values(Literal["draft", "active"] | None) == ("enum", ["draft", "active"])

    def test_three_way_union_is_not_unwrapped(self) -> None:
        # `_unwrap_optional` only collapses a union with exactly one non-None
        # member; anything genuinely ambiguous falls through to "string".
        assert _field_type_and_values(int | bool | None) == ("string", None)

    @pytest.mark.parametrize(
        ("field_name", "expected_type"),
        [
            ("plain_str", "string"),
            ("an_int", "string"),
            ("a_uuid", "string"),
            ("an_optional_uuid", "string"),
            ("a_date", "date"),
            ("a_datetime", "date"),
            ("an_optional_datetime", "date"),
            ("a_bool", "boolean"),
            ("an_optional_bool", "boolean"),
            ("a_literal", "enum"),
            ("an_optional_literal", "enum"),
            ("a_payload", "string"),
        ],
    )
    def test_types_end_to_end_through_derive(self, field_name: str, expected_type: str) -> None:
        # The same table, but read off a real derived schema rather than the
        # helper in isolation — proves `derive_entity_schema` passes
        # `info.annotation` through unmangled.
        schema = derive_entity_schema(_config(create_schema=_TypesProbe))
        assert _fields(schema)[field_name]["type"] == expected_type


# --- field-set union ------------------------------------------------------------------------------


class TestFieldSetUnion:
    def test_union_of_create_update_and_summary_minus_id(self) -> None:
        schema = derive_entity_schema(_widget_config())
        assert set(_names(schema)) == {
            "name",
            "status",
            "project_id",
            "description",
            "owner_id",
            "created_at",
            "is_archived",
        }

    def test_summary_id_is_dropped(self) -> None:
        assert "id" not in _names(derive_entity_schema(_widget_config()))

    def test_derived_order_is_writable_schemas_first_summary_only_last(self) -> None:
        assert _names(derive_entity_schema(_widget_config())) == [
            "name",
            "status",
            "project_id",
            "description",
            "owner_id",
            "created_at",
            "is_archived",
        ]

    def test_summary_only_fields_are_read_only(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert fields["created_at"]["readOnly"] is True
        assert fields["is_archived"]["readOnly"] is True

    def test_writable_fields_omit_read_only_key_entirely(self) -> None:
        # Not `readOnly: False` — the key is absent, matching `FieldConfig`'s
        # own optional-property contract on the frontend.
        fields = _fields(derive_entity_schema(_widget_config()))
        for name in ("name", "status", "project_id", "description", "owner_id"):
            assert "readOnly" not in fields[name]

    def test_update_only_field_is_writable_not_read_only(self) -> None:
        assert "readOnly" not in _fields(derive_entity_schema(_widget_config()))["owner_id"]

    def test_create_schema_none_leaves_update_and_summary_fields(self) -> None:
        schema = derive_entity_schema(
            _config(create_schema=None, update_schema=_WidgetUpdate, summary_schema=_WidgetSummary)
        )
        fields = _fields(schema)
        assert set(fields) == {"name", "description", "owner_id", "status", "project_id", "created_at", "is_archived"}
        # Nothing is required: `required` is sourced from `create_schema` alone.
        assert all(entry["required"] is False for entry in fields.values())

    def test_field_present_in_both_writable_schemas_appears_once(self) -> None:
        names = _names(derive_entity_schema(_widget_config()))
        assert names.count("name") == 1
        assert names.count("description") == 1

    def test_create_schema_annotation_wins_over_update_schema(self) -> None:
        class _CreateBool(BaseModel):
            flag: bool

        class _UpdateStr(BaseModel):
            flag: str | None = None

        schema = derive_entity_schema(
            _config(create_schema=_CreateBool, update_schema=_UpdateStr, summary_schema=_IdOnlySummary)
        )
        assert _fields(schema)["flag"]["type"] == "boolean"


# --- required-ness --------------------------------------------------------------------------------


class TestRequired:
    def test_required_true_only_for_create_schema_required_fields(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert fields["name"]["required"] is True
        assert fields["status"]["required"] is True
        assert fields["project_id"]["required"] is True

    def test_create_schema_optional_field_is_not_required(self) -> None:
        assert _fields(derive_entity_schema(_widget_config()))["description"]["required"] is False

    def test_summary_only_field_is_not_required(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert fields["created_at"]["required"] is False
        assert fields["is_archived"]["required"] is False

    def test_required_on_update_schema_alone_does_not_mark_required(self) -> None:
        # `_RequiredOnUpdate.title` IS required by Pydantic, but only
        # `create_schema` may contribute required-ness.
        schema = derive_entity_schema(_config(create_schema=None, update_schema=_RequiredOnUpdate))
        assert _fields(schema)["title"]["required"] is False

    def test_field_meta_required_true_overrides_derived_false(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"description": FieldMeta(required=True)}))
        assert _fields(schema)["description"]["required"] is True

    def test_field_meta_required_false_overrides_derived_true(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"name": FieldMeta(required=False)}))
        assert _fields(schema)["name"]["required"] is False

    def test_field_meta_required_none_falls_back_to_derived(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"name": FieldMeta(label="Name")}))
        assert _fields(schema)["name"]["required"] is True

    def test_field_meta_required_can_mark_a_summary_only_field_required(self) -> None:
        # `Project.name`'s real shape: logically required, but its create route
        # is bespoke so there's no `create_schema` to derive it from.
        schema = derive_entity_schema(
            _config(
                create_schema=None,
                update_schema=NoSchema,
                summary_schema=_WidgetSummary,
                field_meta={"name": FieldMeta(required=True)},
            )
        )
        entry = _fields(schema)["name"]
        assert entry["required"] is True
        assert entry["readOnly"] is True


# --- FieldMeta overrides --------------------------------------------------------------------------


class TestForeignKeyOverrides:
    def test_ref_entity_promotes_uuid_to_fk(self) -> None:
        schema = derive_entity_schema(
            _widget_config(field_meta={"project_id": FieldMeta(ref_entity="project", label_field="name")})
        )
        entry = _fields(schema)["project_id"]
        assert entry["type"] == "fk"
        assert entry["refEntity"] == "project"
        assert entry["labelField"] == "name"

    def test_uuid_without_ref_entity_stays_string_with_no_fk_keys(self) -> None:
        entry = _fields(derive_entity_schema(_widget_config()))["project_id"]
        assert entry["type"] == "string"
        assert "refEntity" not in entry
        assert "labelField" not in entry

    def test_label_field_omitted_still_emits_an_explicit_null(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"project_id": FieldMeta(ref_entity="project")}))
        entry = _fields(schema)["project_id"]
        assert entry["refEntity"] == "project"
        assert entry["labelField"] is None

    def test_ref_entity_promotes_a_non_uuid_field_too(self) -> None:
        # Nothing gates the promotion on the annotation being `uuid.UUID` —
        # `ref_entity`'s presence alone is the signal.
        schema = derive_entity_schema(_widget_config(field_meta={"name": FieldMeta(ref_entity="project")}))
        assert _fields(schema)["name"]["type"] == "fk"


class TestLabelOverrides:
    def test_default_label_is_title_cased_from_the_field_name(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert fields["name"]["label"] == "Name"
        assert fields["project_id"]["label"] == "Project id"
        assert fields["created_at"]["label"] == "Created at"
        assert fields["is_archived"]["label"] == "Is archived"

    def test_field_meta_label_overrides_the_auto_label(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"project_id": FieldMeta(label="Project")}))
        assert _fields(schema)["project_id"]["label"] == "Project"


class TestShowInTable:
    def test_defaults_to_true_for_every_field(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert all(entry["showInTable"] is True for entry in fields.values())

    def test_field_meta_can_hide_a_field_from_the_table(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"description": FieldMeta(show_in_table=False)}))
        fields = _fields(schema)
        assert fields["description"]["showInTable"] is False
        # ...and only that field.
        assert fields["name"]["showInTable"] is True

    def test_hidden_field_is_still_present_in_the_field_list(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"description": FieldMeta(show_in_table=False)}))
        assert "description" in _names(schema)


class TestFieldMetaForUnknownFieldIsInert:
    def test_meta_naming_a_field_that_does_not_exist_adds_nothing(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"nope": FieldMeta(label="Nope", ref_entity="x")}))
        assert "nope" not in _names(schema)


class TestSortable:
    """ADR-0053 (sort) — mirrors `TestShowInTable`'s own shape verbatim; same
    auto-derive-unless-overridden posture, different `FieldMeta` flag."""

    def test_defaults_to_true_for_every_field(self) -> None:
        fields = _fields(derive_entity_schema(_widget_config()))
        assert all(entry["sortable"] is True for entry in fields.values())

    def test_field_meta_can_mark_a_field_unsortable(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"description": FieldMeta(sortable=False)}))
        fields = _fields(schema)
        assert fields["description"]["sortable"] is False
        # ...and only that field.
        assert fields["name"]["sortable"] is True

    def test_unsortable_field_is_still_present_in_the_field_list(self) -> None:
        schema = derive_entity_schema(_widget_config(field_meta={"description": FieldMeta(sortable=False)}))
        assert "description" in _names(schema)


class TestFieldEntryKeys:
    def test_plain_field_carries_exactly_the_six_base_keys(self) -> None:
        entry = _fields(derive_entity_schema(_widget_config()))["name"]
        assert set(entry) == {"name", "label", "type", "required", "showInTable", "sortable"}


# --- field_order (ADR-0053 Amendment 1) -------------------------------------------------------------


class TestFieldOrder:
    def test_named_fields_lead_in_the_order_given(self) -> None:
        schema = derive_entity_schema(_widget_config(field_order=("created_at", "project_id")))
        assert _names(schema)[:2] == ["created_at", "project_id"]

    def test_unnamed_field_still_appears_appended_in_derived_order(self) -> None:
        # THE load-bearing assertion: `field_order` is order-only, never a
        # filter. `description`/`owner_id`/`is_archived`/`name`/`status` are
        # all absent from `field_order` and must still be served.
        schema = derive_entity_schema(_widget_config(field_order=("created_at", "project_id")))
        assert _names(schema) == [
            "created_at",
            "project_id",
            "name",
            "status",
            "description",
            "owner_id",
            "is_archived",
        ]

    def test_naming_a_single_field_does_not_drop_the_other_six(self) -> None:
        schema = derive_entity_schema(_widget_config(field_order=("owner_id",)))
        assert len(_names(schema)) == 7
        assert _names(schema)[0] == "owner_id"

    def test_field_order_naming_an_unknown_field_is_ignored_not_fatal(self) -> None:
        schema = derive_entity_schema(_widget_config(field_order=("nope", "created_at")))
        assert _names(schema)[0] == "created_at"
        assert "nope" not in _names(schema)
        assert len(_names(schema)) == 7

    def test_empty_field_order_leaves_derived_order_untouched(self) -> None:
        assert _names(derive_entity_schema(_widget_config(field_order=()))) == _names(
            derive_entity_schema(_widget_config())
        )

    def test_full_field_order_reverses_the_whole_list(self) -> None:
        derived = _names(derive_entity_schema(_widget_config()))
        schema = derive_entity_schema(_widget_config(field_order=tuple(reversed(derived))))
        assert _names(schema) == list(reversed(derived))

    def test_reordering_does_not_alter_any_field_entry_content(self) -> None:
        plain = _fields(derive_entity_schema(_widget_config()))
        reordered = _fields(derive_entity_schema(_widget_config(field_order=("is_archived", "owner_id"))))
        assert plain == reordered


# --- enum values + badgeColors ---------------------------------------------------------------------


class TestEnumValuesAndBadgeColors:
    def test_enum_field_carries_its_declared_values(self) -> None:
        assert _fields(derive_entity_schema(_widget_config()))["status"]["values"] == [
            "draft",
            "active",
            "deprecated",
        ]

    def test_non_enum_field_has_no_values_key(self) -> None:
        assert "values" not in _fields(derive_entity_schema(_widget_config()))["name"]

    def test_badge_colors_default_to_the_shared_palette(self) -> None:
        entry = _fields(derive_entity_schema(_widget_config()))["status"]
        assert entry["badgeColors"] == {
            "draft": ENUM_BADGE_COLORS["draft"],
            "active": ENUM_BADGE_COLORS["active"],
            "deprecated": ENUM_BADGE_COLORS["deprecated"],
        }

    def test_badge_colors_are_filtered_to_the_fields_own_values(self) -> None:
        # "draft" is in the shared palette, "banana" is not — and none of the
        # palette's other 15 entries may leak in.
        class _Create(BaseModel):
            status: Literal["draft", "banana"]

        entry = _fields(derive_entity_schema(_config(create_schema=_Create)))["status"]
        assert entry["badgeColors"] == {"draft": ENUM_BADGE_COLORS["draft"]}

    def test_badge_colors_omitted_entirely_when_no_value_matches(self) -> None:
        # `EntryExitCriteria.type`/`TestLog.event_type`'s real shape: the key is
        # absent, not an empty dict, so the frontend's plain-grey default applies.
        class _Create(BaseModel):
            event_type: Literal["banana", "kiwi"]

        entry = _fields(derive_entity_schema(_config(create_schema=_Create)))["event_type"]
        assert "badgeColors" not in entry
        assert entry["values"] == ["banana", "kiwi"]

    def test_field_meta_badge_colors_override_the_shared_palette(self) -> None:
        schema = derive_entity_schema(
            _widget_config(field_meta={"status": FieldMeta(badge_colors={"draft": "primary", "active": "info"})})
        )
        entry = _fields(schema)["status"]
        assert entry["badgeColors"] == {"draft": "primary", "active": "info"}
        # The shared palette is fully replaced, not merged: "deprecated" is in
        # `ENUM_BADGE_COLORS` but absent from the override, so it's gone.
        assert "deprecated" not in entry["badgeColors"]

    def test_override_is_also_filtered_to_the_fields_own_values(self) -> None:
        schema = derive_entity_schema(
            _widget_config(
                field_meta={"status": FieldMeta(badge_colors={"draft": "primary", "not_a_value": "danger"})}
            )
        )
        assert _fields(schema)["status"]["badgeColors"] == {"draft": "primary"}

    def test_empty_override_dict_omits_badge_colors_rather_than_falling_back(self) -> None:
        # `{}` is not `None`, so it wins over the shared palette — and then
        # filters to nothing, so the key is omitted.
        schema = derive_entity_schema(_widget_config(field_meta={"status": FieldMeta(badge_colors={})}))
        assert "badgeColors" not in _fields(schema)["status"]

    def test_shared_palette_is_not_mutated_by_derivation(self) -> None:
        before = dict(ENUM_BADGE_COLORS)
        derive_entity_schema(_widget_config(field_meta={"status": FieldMeta(badge_colors={"draft": "primary"})}))
        assert ENUM_BADGE_COLORS == before

    def test_non_enum_field_with_declared_badge_colors_gets_them_unfiltered(self) -> None:
        # A free-text (non-`Literal`) field has no declared value set to filter
        # against, so a hand-declared palette is passed through as-is.
        schema = derive_entity_schema(_widget_config(field_meta={"name": FieldMeta(badge_colors={"anything": "info"})}))
        entry = _fields(schema)["name"]
        assert entry["type"] == "string"
        assert entry["badgeColors"] == {"anything": "info"}

    def test_non_enum_field_without_declared_badge_colors_has_no_key(self) -> None:
        assert "badgeColors" not in _fields(derive_entity_schema(_widget_config()))["name"]


# --- NoSchema -------------------------------------------------------------------------------------


class TestNoSchema:
    def test_no_schema_as_update_contributes_no_fields(self) -> None:
        schema = derive_entity_schema(
            _config(create_schema=_WidgetCreate, update_schema=NoSchema, summary_schema=_WidgetSummary)
        )
        assert set(_names(schema)) == {
            "name",
            "status",
            "project_id",
            "description",
            "created_at",
            "is_archived",
        }
        assert "owner_id" not in _names(schema)

    def test_no_schema_on_both_writable_slots_makes_every_summary_field_read_only(self) -> None:
        schema = derive_entity_schema(
            _config(create_schema=NoSchema, update_schema=NoSchema, summary_schema=_WidgetSummary)
        )
        fields = _fields(schema)
        assert set(fields) == {"name", "status", "project_id", "created_at", "is_archived"}
        assert all(entry["readOnly"] is True for entry in fields.values())
        assert all(entry["required"] is False for entry in fields.values())

    def test_no_schema_everywhere_yields_an_empty_field_list(self) -> None:
        schema = derive_entity_schema(
            _config(create_schema=NoSchema, update_schema=NoSchema, summary_schema=_IdOnlySummary)
        )
        assert schema["fields"] == []


# --- entity-level keys ----------------------------------------------------------------------------


class TestTopLevelShape:
    def test_response_carries_exactly_the_nine_documented_keys(self) -> None:
        assert set(derive_entity_schema(_widget_config())) == {
            "resource",
            "label",
            "methods",
            "scopeField",
            "scopeSelector",
            "scopeResolution",
            "searchFields",
            "filterFields",
            "fields",
        }

    def test_resource_is_passed_through_verbatim(self) -> None:
        assert derive_entity_schema(_config(resource="test_condition"))["resource"] == "test_condition"

    def test_label_falls_back_to_display_name_when_unset(self) -> None:
        assert derive_entity_schema(_config(resource="test_condition"))["label"] == "Test condition"

    def test_explicit_label_wins_over_display_name(self) -> None:
        assert derive_entity_schema(_config(resource="test_condition", label="Test Conditions"))["label"] == (
            "Test Conditions"
        )

    def test_search_and_filter_fields_are_serialized_as_lists(self) -> None:
        schema = derive_entity_schema(_config(search_fields=("title", "code"), filter_fields=("status",)))
        assert schema["searchFields"] == ["title", "code"]
        assert schema["filterFields"] == ["status"]

    def test_empty_search_and_filter_fields_are_empty_lists_not_tuples(self) -> None:
        schema = derive_entity_schema(_config())
        assert schema["searchFields"] == []
        assert schema["filterFields"] == []


class TestMethods:
    def test_methods_are_sorted(self) -> None:
        schema = derive_entity_schema(_config(methods=frozenset({"list", "get", "create", "update", "delete"})))
        assert schema["methods"] == ["create", "delete", "get", "list", "update"]

    def test_restricted_methods_are_reported_as_declared(self) -> None:
        assert derive_entity_schema(_config(methods=frozenset({"list", "get"})))["methods"] == ["get", "list"]

    def test_full_methods_overrides_methods_in_the_output(self) -> None:
        # A `Project`-shaped fixture, as of ADR-0055 (before ADR-0059 added
        # `create` to `Project`'s own real `full_methods` too) — this test is
        # about the general mechanism (`full_methods` overriding `methods` in
        # the served output), not a live assertion about Project's current
        # real shape; see `test_adr53_entity_schema.py`'s own
        # `test_projects_methods_reflect_full_methods_not_the_factory_registered_two`
        # for that.
        config = _config(
            methods=frozenset({"list", "delete"}),
            full_methods=frozenset({"list", "get", "update", "delete"}),
        )
        assert derive_entity_schema(config)["methods"] == ["delete", "get", "list", "update"]

    def test_full_methods_does_not_mutate_the_configs_own_methods(self) -> None:
        config = _config(
            methods=frozenset({"list", "delete"}),
            full_methods=frozenset({"list", "get", "update", "delete"}),
        )
        derive_entity_schema(config)
        assert config.methods == frozenset({"list", "delete"})

    def test_full_methods_output_is_sorted_too(self) -> None:
        config = _config(methods=frozenset({"list"}), full_methods=frozenset({"update", "create", "list"}))
        assert derive_entity_schema(config)["methods"] == ["create", "list", "update"]

    def test_full_methods_none_falls_back_to_methods(self) -> None:
        config = _config(methods=frozenset({"list", "get"}), full_methods=None)
        assert derive_entity_schema(config)["methods"] == ["get", "list"]


class TestScopeField:
    def test_single_string_scope_field_passes_through(self) -> None:
        assert derive_entity_schema(_config(scope_field="project_id"))["scopeField"] == "project_id"

    def test_tuple_scope_field_is_serialized_as_a_list(self) -> None:
        # `RiskItem`'s branching `requirement_id`-or-`test_plan_id` shape.
        schema = derive_entity_schema(_config(scope_field=("requirement_id", "test_plan_id")))
        assert schema["scopeField"] == ["requirement_id", "test_plan_id"]
        assert isinstance(schema["scopeField"], list)

    def test_none_scope_field_stays_none(self) -> None:
        # Global-catalog entities (`TestLevel`/`TestType`/`Permission`).
        assert derive_entity_schema(_config(scope_field=None))["scopeField"] is None


class TestScopeSelector:
    def test_absent_scope_selector_is_none(self) -> None:
        assert derive_entity_schema(_config())["scopeSelector"] is None

    def test_single_option_serializes_as_an_object_not_a_list(self) -> None:
        schema = derive_entity_schema(
            _config(scope_selector=ScopeSelectorOption(ref_entity="project", param_name="project_id"))
        )
        assert schema["scopeSelector"] == {"refEntity": "project", "paramName": "project_id"}

    def test_option_label_is_omitted_when_unset(self) -> None:
        schema = derive_entity_schema(
            _config(scope_selector=ScopeSelectorOption(ref_entity="project", param_name="project_id"))
        )
        assert "label" not in schema["scopeSelector"]

    def test_option_label_is_included_when_set(self) -> None:
        schema = derive_entity_schema(
            _config(
                scope_selector=ScopeSelectorOption(ref_entity="project", param_name="project_id", label="Project")
            )
        )
        assert schema["scopeSelector"]["label"] == "Project"

    def test_tuple_of_options_serializes_as_a_list_in_order(self) -> None:
        # `RiskItem`'s two-option branching scope.
        schema = derive_entity_schema(
            _config(
                scope_selector=(
                    ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id", label="Requirement"),
                    ScopeSelectorOption(ref_entity="test_plan", param_name="test_plan_id"),
                )
            )
        )
        assert schema["scopeSelector"] == [
            {"refEntity": "requirement", "paramName": "requirement_id", "label": "Requirement"},
            {"refEntity": "test_plan", "paramName": "test_plan_id"},
        ]

    def test_single_element_tuple_still_serializes_as_a_list(self) -> None:
        schema = derive_entity_schema(
            _config(scope_selector=(ScopeSelectorOption(ref_entity="project", param_name="project_id"),))
        )
        assert isinstance(schema["scopeSelector"], list)
        assert len(schema["scopeSelector"]) == 1


class TestScopeResolution:
    def test_absent_scope_resolution_is_none(self) -> None:
        assert derive_entity_schema(_config())["scopeResolution"] is None

    def test_scope_resolution_is_serialized_in_camel_case(self) -> None:
        schema = derive_entity_schema(
            _config(
                scope_resolution=ScopeResolution(
                    from_route_param="projectId", via_entity="project", via_field="org_id"
                )
            )
        )
        assert schema["scopeResolution"] == {
            "fromRouteParam": "projectId",
            "viaEntity": "project",
            "viaField": "org_id",
        }

    def test_org_id_route_param_variant(self) -> None:
        schema = derive_entity_schema(
            _config(
                scope_resolution=ScopeResolution(from_route_param="orgId", via_entity="organization", via_field="id")
            )
        )
        assert schema["scopeResolution"]["fromRouteParam"] == "orgId"


# --- determinism ------------------------------------------------------------------------------------


class TestDeterminism:
    def test_repeated_derivation_of_the_same_config_is_identical(self) -> None:
        config = _widget_config(
            field_meta={"project_id": FieldMeta(ref_entity="project", label_field="name")},
            field_order=("project_id", "name"),
            scope_selector=ScopeSelectorOption(ref_entity="project", param_name="project_id"),
        )
        assert derive_entity_schema(config) == derive_entity_schema(config)
