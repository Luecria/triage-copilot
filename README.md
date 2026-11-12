# Triage Copilot

A Forge app for Jira that triages issues automatically — built for
**Codegeist 2026** (category: Apps for Software Teams).

## What it does

Open any Jira issue and Triage Copilot shows:

1. **Definition-of-done checklist** — 7 checks (acceptance criteria,
   assignee, priority, estimate, parent/epic, reproduction steps, labels)
   with the exact field that fails named.
2. **Severity score** — deterministic 0–100 rule score with evidence
   (issue type, priority, blockers, and more).
3. **Suggested assignee** — ranked candidates with reasons, using the
   **Teamwork Graph API** (reporter's teams, team members, open workload)
   plus Jira data (recent commenters).
4. **Possible duplicates** — JQL text search + similarity, confirmation
   gated, linked — never auto-closed. Dedupe is a supporting feature,
   not the headline.

One click on **Apply triage…** (after a confirmation preview) sets the
assignee, posts a triage comment, and links a confirmed duplicate —
with the link direction decided by which issue is newer.

## Three surfaces, one triage

- **Jira issue panel** (UI Kit, `jira:issuePanel`) — instant, no waiting.
- **Rovo agent** (`rovo:agent`, "Triage Copilot") — chat "Triage PLAT-123",
  proposes the triage, asks for confirmation, then applies it.
- **MCP server** (`rovo:mcp`) — the same 6 tools
  (`get-issue`, `get-dod-checklist`, `score-severity`, `suggest-assignee`,
  `find-similar-issues`, `apply-triage`) callable from any MCP client.

## Install (judges)

Use the installation link from the
[Codegeist 2026 submission](https://codegeist2026.devpost.com/).
Installing user must be a site admin. The app only requests Jira API
permissions and stores no personal data — see [PRIVACY.md](PRIVACY.md).

## Run it yourself

```sh
npm install
forge deploy -e development
forge install -e development -p Jira
```

Requires the Forge CLI and a Developer Space. See `AGENTS.md` for the
house rules (UI Kit only, `asUser()` preferred, `forge lint` after
manifest changes).

## How it works

- `src/dod.js` — the 7-check definition-of-done checklist.
- `src/severity.js` — the 0–100 rule score with evidence.
- `src/twg.js` — Teamwork Graph client (curated queries, paging, retries).
- `src/assignee.js` — candidate ranking from TWG + Jira.
- `src/dedupe.js` — JQL search + Jaccard similarity.
- `src/apply.js` — confirmation-gated writes (comment, assignee, link).
- `src/triage.js` — orchestrator; `src/index.js` — action handlers +
  panel resolver; `src/frontend/index.jsx` — the issue panel.
- `prompts/prompt.md` — the Rovo agent prompt.

## License

MIT — see `LICENSE` if present. Built during Codegeist 2026
(27 Oct – 22 Dec 2026).
