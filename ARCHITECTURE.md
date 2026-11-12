# Architecture — Triage Copilot (Forge app for Jira)

Date: 2026-11-11 (Phase 1). Companion: `NOTES-PHASE1.md` (research), `PLAN.md` (brief).
Positioning guardrail: **duplicate detection is a supporting feature only.** The product leads with DoD checklist, severity calibration, and Teamwork Graph assignee suggestion. The UI, the agent prompt, the MCP tool list, and the demo story all lead with those three — dedupe appears last, as "possible duplicates".

## 1. Module map (manifest.yml)

| Module | Key | Purpose |
|---|---|---|
| `rovo:agent` | `triage-copilot` | Triage agent in Rovo chat. Prompt from `prompts/prompt.md` (resource). Conversation starters: "Triage this issue", "Who should work on this?", "Is this a duplicate?". |
| `action` | `get-issue` (GET) | Read one issue (summary, description, fields, status, assignee, reporter, comments). |
| `action` | `get-dod-checklist` (GET) | Compute the definition-of-done checklist for an issue. |
| `action` | `score-severity` (GET) | Compute the severity score + band + evidence list. |
| `action` | `suggest-assignee` (GET) | Rank assignee candidates from Teamwork Graph + Jira signals. |
| `action` | `find-similar-issues` (GET) | Supporting dedupe: JQL text search + similarity score. |
| `action` | `apply-triage` (CREATE/UPDATE) | **Confirmation-gated write**: assign + post triage comment + link duplicates. Requires `confirmed: true` or it errors without touching Jira. |
| `rovo:mcp` | `triage-copilot-mcp` | Remote MCP server exposing the six tools above (same actions). |
| `jira:issuePanel` | `triage-panel` | UI Kit panel on the issue: DoD checklist, severity, assignee suggestions, possible duplicates, Apply button. `render: native`. |
| `function` | one per action + panel resolver | Handlers in `src/`. |

Runtime: `nodejs24.x`. Packages: `@forge/api` 8.5.0 (for `requestJira` + `requestTeamworkGraph`), `@forge/cli` 15.x for build (needs Node 22.23.4+).

## 2. Scopes (9 total, cap is 50)

```
read:jira-work        # read issue, JQL search
write:jira-work       # edit issue (assignee), post comment as the user
read:jira-user        # resolve people
read:comment:jira     # read comment history (ownership signals)
write:comment:jira    # post triage result as a comment
read:graph:issue:jira
read:graph:issue-status:jira
read:graph:user:atlassian
read:graph:team:atlassian
```

Three scopes were removed after usage audits proved them unused:
`read:issue.transition:jira` (no transition code anywhere) and
`read:graph:goal:atlassian` (only the never-called goals query needed
it; that query was removed with the scope) in Phase 3, and
`read:graph:issue-comment:jira` (only the never-called
work-item-comments query needed it; that query was removed with the
scope) in the post-review fix.

All reads run **asUser** (permission-filtered to what the user can see). All writes run **asUser** too — nothing is ever written as the app. Teamwork Graph calls use `api.asUser().requestTeamworkGraph(...)` (the only supported path).

## 3. Data flow

```
Issue opened (panel)  ─┐
Rovo chat "triage X" ──┼─► resolver / agent actions (GET, asUser)
MCP client call ───────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 1. READ issue via Jira REST (/rest/api/3/issue/{key})  │
  │    fields: summary, description, type, priority,       │
  │    status, assignee, reporter, components, labels,     │
  │    story points / estimate, parent/epic link, comments │
  ├─────────────────────────────────────────────────────────┤
  │ 2. DoD CHECKLIST (deterministic rules + Rovo wording)  │
  │    - acceptance criteria present?  - assignee set?     │
  │    - priority set?  - estimate present?                │
  │    - parent/epic linked?  - repro steps (if bug)?      │
  │    - labels/components set?  Each item: pass / fail /  │
  │    n/a, with the field it checked.                     │
  ├─────────────────────────────────────────────────────────┤
  │ 3. SEVERITY (deterministic score 0–100 + band,         │
  │    always with evidence)                                │
  │    Signals: type, priority, blocking/blocked-by links, │
  │    watcher count, "outage/down/broken" wording,        │
  │    affected-component breadth, age without update.     │
  │    Band: Critical ≥80, High ≥60, Medium ≥40, Low <40. │
  │    Rovo may adjust ±10 with a stated reason; the rule  │
  │    score and the reason are both shown (calibration).  │
  ├─────────────────────────────────────────────────────────┤
  │ 4. ASSIGNEE (Teamwork Graph + Jira signals)            │
  │    - TWG: team members → their assigned work items     │
  │      (atlassianUserAssignedJiraWorkItems, 25/page)      │
  │    - Jira REST: recent commenters on this issue        │
  │      (comments from the issue read, P90D)               │
  │    - Jira: past assignees of same component/labels     │
  │    Rank by: prior work on same component, recent       │
  │    activity on similar issues, current open workload   │
  │    (fewer open items = more available). Top 3, each    │
  │    with reasons. Never auto-assign.                    │
  ├─────────────────────────────────────────────────────────┤
  │ 5. DUPLICATES — SUPPORTING ONLY (JQL + similarity)     │
  │    JQL text search on summary keywords, then token-    │
  │    overlap similarity on normalized summary +          │
  │    description. ≥0.80 "likely duplicate", 0.50–0.80    │
  │    "possibly related". Shown last, linked not closed.  │
  └─────────────────────────────────────────────────────────┘
        │
        ▼
  Outputs (all read-only until the user confirms):
  - Issue panel: DoD checklist → severity + evidence → assignee top 3 → possible duplicates → [Apply triage] button
  - Rovo chat: same triage as a composed summary, with "shall I apply it?" confirmation turn
  - MCP: the six tools above, same actions, same gate
        │
        ▼ (only after explicit confirmation)
  apply-triage (confirmed: true):
  - assign the chosen person (or leave unassigned)
  - post the triage summary as a comment
  - link likely duplicates ("is duplicated by" / relates to)
  - re-checks similarity immediately before writing; if a
    candidate crossed the threshold since the read, it is held
    back and reported instead of written
```

## 4. Confirmation gate (in code, not in prose)

Four layers — a write must pass all four, or nothing is written:

1. **Prompt never writes.** The agent prompt says: propose, never apply; ask before any write.
2. **Contract gate.** `apply-triage` requires `confirmed: true` in its inputs. Without it the function errors out before any Jira call. The panel's Apply button is the only path that sets it (after showing a preview).
3. **Dedupe safety net.** Immediately before writing, re-run `find-similar-issues` for the target issue. A candidate at similarity ≥ 0.80 that was not in the confirmed list blocks the write for that item and is reported.
4. **asUser + audit.** Every write runs as the user who confirmed, so Jira permissions apply and the change is attributed to them. The panel shows exactly what will be written before the button is clicked.

Automation rules cannot call CREATE/UPDATE/DELETE/TRIGGER actions at all (Forge rule) — so there is no silent-write path through automation either.

## 5. Teamwork Graph usage (assignee suggestion)

- Client: `src/twg.js` — one call (`twg`) + paged reader (`twgAll`), copied pattern from the measured Codegeist tutorial: operation names `[company]_[operation]` (ours: `triagecopilot_*`, company ≥3, operation ≥4), up to 3 retries on transient errors with backoff, `complete: false` when paging stops early, and "could not read" (never "nothing there") on empty+errors.
- Curated queries consumed by the assignee ranking (the complete set,
  three): `atlassianUserAssignedJiraWorkItems` (open workload),
  `atlassianUserInTeams` (reporter's teams), `atlassianTeamMembers`
  (team members). The ranking reads comments from the Jira REST issue
  read (`src/jira.js`), not from TWG. Field names were verified in
  Phase 3
  against the live TWG schema downloaded from the real demo site
  (`one-atlas-aggc.atlassian.net/gateway/api/graphql/twg/schema`,
  172 KB): correct argument/field names are `teamAri`,
  `id` (not `workItemId`), `displayName`, `accountId` + `name`,
  `createdAt`, and the edge `cursor` (declared `String!` but returned
  null) was removed from all queries. Live panel check confirmed the
  ranking returns real team + workload data (PLAT-33510: Mandala Putra
  score 16 = commenter +4, team +2, workload +10, no "could not read"
  warning).
- Page size 25, max 4 pages per list by default. Rate-limit behaviour (~128 calls / 20 s → zero-row responses) handled by the retry + incomplete-reporting rule.
- The agent prompt carries the incompleteness rule: if a source could not be read, say the answer may be incomplete — never invent people, teams, or items.

## 6. Bonus-track mapping

| Bonus ($1,500 each, 6 winners) | How we qualify | Evidence in the app |
|---|---|---|
| Best Agents - Rovo/Assignable agents | `rovo:agent` + reusable GET actions other agents can call | Agent + actions in manifest; demo in Rovo chat |
| Best app with Atlassian MCP | Tools exposed through `rovo:mcp` | MCP server verified end-to-end from an external client (Glama MCP Inspector) in Phase 3 |
| Best Teamwork Graph integration | Consumes data from the Teamwork Graph API (assignee suggestion) | `suggest-assignee` reads TWG; demo shows it |
| Best Marketplace published app | **NOT targeted in v1** | Listing requires review; a licensed/listing-submitted app cannot use an installation link, so chasing it would force a second unlicensed copy of the app. Defer to post-hackathon. |

One entry can win max 1 grand prize + 1 bonus prize. We enter all three bonuses above and let the judges pick the strongest.

## 7. What the demo video must show (<5 min)

1. Open a real Jira issue → panel shows DoD checklist (fails named), severity with evidence, assignee top 3 with reasons, possible duplicates last.
2. Click Apply → assignee set + comment posted + duplicate linked (show the issue updating).
3. Same triage in Rovo chat ("triage PROJ-123") → agent proposes, user confirms, applied.
4. MCP: one tool call from an external client (Claude Code) returning the same triage.
5. State the positioning in the first 15 seconds: "DoD, severity, and who should own it — dedupe included, not the headline."

## 8. Risks / open items for Phase 2

1. **Panel ↔ agent coupling**: verify whether the issue panel can trigger the agent or show agent output, or whether panel and agent stay separate surfaces (affects the demo story). Test in the scaffold.
2. **Demo-site TWG scopes**: `forge site provision` demo sites include enterprise editions + Rovo, but whether Teamwork Graph scopes are granted without extra admin steps is untested — verify in Phase 2.
3. **Rovo credit burn**: Standard 25 / Premium 70 credits per user/month; agent call ≈ 10 credits. Prefer the demo site for testing; watch the 3 Dec 2026 overage-billing start on any trial site.
4. **Latency**: measured Rovo answers take 28–32 s end-to-end. The video leads with the panel (instant) and shows the agent second.
5. **Dedupe threshold tuning**: similarity ≥ 0.80 for "likely duplicate" is a starting point borrowed from SpecTrace; tune against the demo site's seeded data in Phase 2.
6. **Severity calibration data**: the rule score needs real examples to tune; use the demo site's seeded issues plus a handful of hand-written cases in Phase 2.
