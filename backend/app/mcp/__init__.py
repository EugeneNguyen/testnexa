"""First-party MCP server surface (MCP-1, ADR-0033).

Public symbols re-exported here:

- `mcp` — the configured `mcp.server.fastmcp.FastMCP` instance,
  registered against the FastAPI app at `/mcp` by `app/main.py`.
  Tool implementations live in `app.mcp.tools` and are imported by
  `app.mcp.server` to register their `@mcp.tool()` decorators against
  this instance — there is exactly one `FastMCP` for the whole backend,
  by design (no per-tool `FastMCP`, no per-module registration; the
  ADR-0033 single-server choice is what `app/main.py` mounts).
"""
