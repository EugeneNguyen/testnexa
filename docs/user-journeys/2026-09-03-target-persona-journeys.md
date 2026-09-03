# User Journeys — Sovereign AI Testing

**Date:** 2026-09-03
**Owner:** Product discovery (AI PM), on behalf of xuanbinh91@gmail.com
**Status:** Fresh — no journey-mapping doc existed prior to this. HYPOTHESIS throughout: journeys are inferred from personas + the MVP/experiment design, not observed pilot behavior.

## Basis and confidence

Each journey maps a persona from [2026-09-03-target-personas.md](../personas/2026-09-03-target-personas.md) through the product as currently scoped in [26-mvp.md](../product-discovery/26-mvp.md) and validated (or not yet) via [27-experiment.md](../product-discovery/27-experiment.md). Touchpoints reflect the MVP's actual in-scope surface (Docker Compose deploy, BYO-LLM setup, MCP server, basic auth) — not the full 07 ERD scaffold, since that's a separate, not-yet-validated engineering decision (see the scaffold spec's own flagged deviation). Emotions/pain points are inferred from the cited pain research (03) and 26/27/29's own risk analysis, not observed. Every step below should be read as **what we believe will happen**, to be corrected against real pilot data.

**Format:** Step → Touchpoint → Emotion/Pain → Opportunity, per persona, covering awareness through sustained use (or drop-off).

---

## Journey 1 — Priya (secondary persona: self-hosted OSS QA lead)

| Step | Touchpoint | Emotion / Pain Point | Opportunity |
|---|---|---|---|
| 1. Awareness | Sees the product mentioned in a Kiwi TCMS or Squash TM community forum post (27's actual recruitment channel) | Curious but skeptical — has seen "AI-powered" claims before that turned out to be shallow wrappers | Lead with the specific differentiator (self-hosted + BYO-LLM) in the very first message, not generic "AI-powered" marketing language |
| 2. Evaluation | Reads product docs / README, compares to her current tool | Cautiously optimistic if self-hosting is confirmed upfront; drops off immediately if it isn't obvious in the first screen (09's canvas: self-hosting is her non-negotiable) | Put "runs entirely on your infrastructure" above the fold, not buried in a features list |
| 3. Setup | Docker Compose deploy (26's in-scope MVP touchpoint) | Neutral-to-positive if it's genuinely one command; frustration if it isn't — this is 26's flagged risk #1 (setup abandonment), the single biggest untested assumption in the whole MVP | This step **is** the activation metric (27: ≥60% complete setup + generate ≥1 test case in week 1) — every friction point here directly costs the experiment's headline number |
| 4. BYO-LLM configuration | Enters API key (commercial provider) or points at local Ollama endpoint | Anxiety if the local-model path is confusing — 27 notes this path is concierge-simulated for the pilot, meaning the *real* self-serve version is explicitly untested at this stage | Concierge-assist during the pilot is a deliberate stopgap (27) — flag this as a known gap, not a solved problem, when reading pilot results |
| 5. First generation | Pastes a requirement, generates draft test cases via BYO-LLM | Make-or-break moment — 26's risk #2: is output "usable with light edits" or does she discard it and go back to writing by hand? | This is where 27's quality metric (≥60% "usable with light edits") is decided; if this fails, no amount of onboarding polish saves adoption |
| 6. Sustained use | Returns to generate test cases for subsequent features, tracks execution (pass/fail/blocked) | Relief/confidence if the tool becomes her default; quiet abandonment (opens ChatGPT/Cursor manually instead) if not — this exact behavior is what 26 defines as the falsification condition | Instrumented usage logging (26, day-one scope) is the only way to detect quiet abandonment vs. genuine adoption — make sure this data is actually reviewed weekly during the pilot, not just at day 30 |
| 7. Renewal/expansion (post-MVP, unscoped) | Pricing conversation (27's WTP check-in) | Untested — no persona-specific WTP evidence exists (personas doc, 22) | This step doesn't exist in the current MVP build — it's a conversation, not a product surface; flag for 25's business-model work once 27 has data |

---

## Journey 2 — Marcus (primary/beachhead persona: regulated compliance QA manager)

| Step | Touchpoint | Emotion / Pain Point | Opportunity |
|---|---|---|---|
| 1. Awareness | Direct outreach targeting public GDPR/self-hosting requirements in job postings, or a security/compliance-focused Slack/Discord community (27's actual recruitment channel for this persona) | Guarded — he's already rejected Squash TM once (11 Tier 2) and treats vendor claims about "traceability" skeptically until proven | Recruitment messaging should acknowledge the rejection pattern directly ("if you've already looked at Squash TM and it was too heavy...") rather than pretend he's a blank slate |
| 2. Evaluation | Data-residency/compliance questions before anything else — does generation data leave his infrastructure? | This is his single non-negotiable gate (03 #9) — a "yes, technically, but..." answer ends the evaluation immediately | Self-hosted + BYO-LLM answers this cleanly and structurally, not with a policy promise — make the architecture itself the answer, not a compliance page |
| 3. Setup | Same Docker Compose + BYO-LLM flow as Persona 1 — **but** the MVP explicitly does not include the traceability depth (TestCondition, full RTM, standards export) that is his actual stated need (26's cut list, 07's extended entities) | Real risk of a mismatch here: he came for traceability, the MVP gives him AI generation on a lightweight requirement→test-case model instead — **this is the exact gap 29's pre-mortem cause 10 flagged** ("pilots may love AI-generation and still not convert if the real switching decision depends on traceability/RBAC/migration tooling deliberately cut from the MVP") | This journey step is where the MVP's scope cut is riskiest for this specific persona — 27's experiment should ask him directly "what would you need before actually replacing your current tool," per 29's own recommendation, not assume AI generation alone answers his gate |
| 4. First generation | Same as Journey 1 | Same quality-perception risk, but he will also be silently checking whether output maps cleanly to something he could defend to an auditor later (a need the MVP doesn't structurally support yet) | If pilot feedback shows him asking for traceability features unprompted, that's a strong signal — not just qualitative color, direct evidence for the 29-flagged risk |
| 5. Sustained use | Same instrumented usage tracking | More likely than Persona 1 to disengage quietly if traceability isn't there, even if generation quality is good — his adoption is gated by a feature not yet built, not by generation quality | Track his usage pattern separately from Persona 1's in 27's weekly check-ins — don't average the two personas' adoption numbers together, or a Persona-1 win can mask a Persona-2 failure |
| 6. Would-need conversation (29's flagged addition) | Dedicated qualitative question beyond 27's standard script | Candor here is the single most valuable data point this pilot can produce for this persona | Add this explicitly to the pilot script now, before day 1 — it's cheap to add and 29 already told us it's missing |
| 7. Renewal/expansion (post-MVP, unscoped) | Pricing + "would you actually switch" conversation | His stated WTP evidence is the strongest of the three personas via adjacent-market proxy (22), but unconfirmed for this specific product | Same as Journey 1 — not yet a product surface |

---

## Journey 3 — Agent-primary team (exploratory persona)

| Step | Touchpoint | Emotion / Pain Point | Opportunity |
|---|---|---|---|
| 1. Awareness | **Not currently reached by 27's recruitment plan** (personas doc flagged this gap) — no self-hosted/security community outreach is aimed at this segment specifically | This persona doesn't know to look for this category at all (11 Tier 3: "never in the market") | If this segment is added to the pilot, awareness has to happen through developer/agent-tooling channels (e.g., MCP ecosystem discussions), not QA communities — a different acquisition channel entirely from Personas 1/2 |
| 2. Evaluation | Would likely evaluate this as "does my agent get an MCP server it can drive," not as a QA-tool feature comparison | Genuinely novel — no comparison framework exists yet from this segment's side (06, 11) | Positioning this journey step may require entirely different language ("agent-operable test infrastructure") rather than "test management tool" |
| 3. Setup / first use | Same Docker Compose + MCP server touchpoint, but the *primary* actor driving usage is the AI agent (via MCP), not a human filling in a web form | Uncertain — 26's MCP surface (create/list/update TestCase, create TestExecution, read Requirement) was scoped for human-directed agent assistance, not autonomous agent-primary operation; whether it holds up under this persona's actual usage pattern is untested | This is the least-built-for path in the current MVP — worth a deliberate, small, separate probe rather than folding into 27's existing 10–12-org pilot, since the usage pattern and success metrics (what does "activation" even mean when there's no human logging in?) genuinely differ |
| 4. Sustained use | Unknown — no economic buyer identified (personas doc), no billing/usage model designed for a no-QA-role team | Completely unvalidated | Don't build for this persona yet — treat as 07's Actor-model already provides the structural hook (AIAgent as first-class Actor), so the *option* to serve this segment later isn't blocked by today's architecture, but active pursuit should wait for its own validation cycle |

---

## Cross-journey insight

**INSIGHT:** Journeys 1 and 2 share every touchpoint through step 5, but diverge sharply on what "success" looks like at step 5 — Priya's success is generation quality alone; Marcus's success is generation quality **plus** a traceability need the MVP doesn't build. Averaging their adoption/quality numbers together in 27's results would hide this — **RECOMMENDATION: segment 27's pilot metrics by persona, not just report an aggregate.** This is a direct, actionable consequence of mapping the journeys side by side that wasn't visible from the personas alone.

**RECOMMENDATION:** Add the "what would you need before actually replacing your current tool" question (29's own recommendation, echoed at journey step 6 for Marcus) to the pilot script before day 1 if it isn't already there — it's the cheapest fix available for the single most important gap this journey-mapping exercise surfaced.

**RECOMMENDATION:** Decide explicitly whether to fold a small agent-primary cohort into the existing pilot or defer it entirely — Journey 3 shows the touchpoints and success metrics genuinely differ, not just the persona description. Folding it in without adjusting the pilot design risks collecting data that doesn't actually answer either segment's question well.

## Sources
- [Personas](../personas/2026-09-03-target-personas.md)
- [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md)
- [03 — Customer Pain](../product-discovery/03-customer-pain.md), [09 — Strategy Canvas](../product-discovery/09-strategy-canvas.md), [11 — Noncustomers](../product-discovery/11-noncustomers.md), [22 — Willingness to Pay](../product-discovery/22-willingness-to-pay.md), [26 — MVP](../product-discovery/26-mvp.md), [27 — 30-Day Experiment](../product-discovery/27-experiment.md), [29 — Pre-Mortem](../product-discovery/29-pre-mortem.md)
