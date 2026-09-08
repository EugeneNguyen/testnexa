---
name: login-ratelimit-false-positive-under-concurrent-load
description: test_auth_login.py's rate-limit test fails spuriously when e2e specs log in concurrently against the same stack; rerun it alone before treating it as a regression
metadata:
  type: project
---

`backend/tests/integration/test_auth_login.py::test_login_failure_count_behavior_across_a_successful_login`
fails spuriously if anything else is logging in against the same stack at the
same time (a Playwright run, another pytest process, a second agent). Observed
2026-09-06 during PLAN-2: it FAILED inside a full `pytest tests/integration`
run while an e2e suite was mid-flight, then passed 10/10 when rerun alone
seconds later, with no code change in between.

**Why:** login rate limiting is keyed on `(client_ip, email)` with a 5-failure
/ 15-minute budget that resets on a successful login for that pair (ADR-0011).
Every process on the host shares one `client_ip` from the server's point of
view, so a concurrent suite's logins mutate the very counter this test asserts
on. Nothing about the failure message hints at cross-process interference — it
reads like a real rate-limiter regression.

**How to apply:** this is the auth-layer sibling of the `--workers=1` rule in
`e2e/CLAUDE.md`. Never run the backend integration suite and an e2e suite
against the same stack concurrently — and if this specific test (or any
rate-limit assertion) fails inside a broader/parallel run, rerun that file
alone before reporting it as a regression. Also relevant when parallelising
subagents: two agents told to "run the tests" against one shared stack will
manufacture this failure for each other. See
[[known-red-e2e-specs]] for the same "known-red, don't chase it" discipline at
the e2e layer.
