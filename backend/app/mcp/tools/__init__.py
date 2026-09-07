"""MCP tool implementations.

Importing this package registers the tools in this module against the
shared `FastMCP` instance in `app/mcp/server.py` — `server.py`'s
`register_tools()` is the single import-and-register hook called at app
startup by `app/main.py`. See ADR-0033 decision 2 for why each tool
dispatches by *direct call* into the existing REST route handler (bypassing
FastAPI's `Depends` defaults with explicit `actor=`/`db=`), not by in-process
ASGI dispatch over the live FastAPI app.
"""
