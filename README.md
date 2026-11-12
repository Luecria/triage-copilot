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
[Codegeist 2026 submission](https://devpost.com/software/triage-copilot-bnc40l)
(or install directly from the
[installation link](https://developer.atlassian.com/console/install/1146f277-7b1f-4320-a0f8-19ad51c9ccb8?signature=AYABeBAR2h7B1NECDP8FRgyMdIAAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBdyDGJs06NMUk3Jd6py8lJAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDKQXFrJTs8uIkpDBywIBEIA7LWJwUy3jYSfy%2BlVovHZB1CHnb85gMnNjDhUUFQrNUS%2FV%2F3rEaiQ1%2BqS9YOahX%2BHY7%2BEtXaSbClfYJIMAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgE70Zfh%2Fw8oYdHtoWTIREUHAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM8K4kMGN5j5I6InoyAgEQgDsaK4E3LGace4QaRZNZvdg%2BsJFea%2Fjp3VARlNIR11Cv4ifxyoOVXzf70yboupOUo8hyWgwRzyNqlcXSigAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAeu9SFKYATOhIUHcfuOUrHcAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzZRyghj7wclW%2BcLJICARCAO16lIOb%2FMw7ORpU9kQGrV8o5vjeSpu73Q8Q%2FKnOhthoYO7Wym%2FcG0f9gdsozIzM6kg1ruKPCEGQ9beHuAgAAAAAMAAAQAAAAAAAAAAAAAAAAAN2HOcf3s06kfcQuuE8NJEP%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJlPaepYz8mvJgV9iFMWbyW7R9ksMnf%2BpLgfqJQ3Ax787O6UrCKecY8vpzDNVCTMmvefaktdC2Z5xVMtErE3DC6%2FAY%3D&product=jira)).
Installing user must be a site admin. The app only requests Jira API
permissions and stores no personal data — see [PRIVACY.md](PRIVACY.md).
For step-by-step testing (panel, Rovo agent, MCP server), see
[Testing](#testing) below.

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

- `src/jira.js` — the single Jira issue read (fields, links, comments).
- `src/text.js` — ADF ↔ plain text, tokenising, Jaccard similarity.
- `src/dod.js` — the 7-check definition-of-done checklist.
- `src/severity.js` — the 0–100 rule score with evidence.
- `src/twg.js` — Teamwork Graph client (curated queries, paging, retries).
- `src/assignee.js` — candidate ranking from TWG + Jira.
- `src/dedupe.js` — JQL search + Jaccard similarity.
- `src/apply.js` — confirmation-gated writes (comment, assignee, link).
- `src/triage.js` — orchestrator; `src/index.js` — action handlers +
  panel resolver; `src/frontend/index.jsx` — the issue panel.
- `prompts/prompt.md` — the Rovo agent prompt.

## Testing

1. **Install.** Open the installation link above as a Jira site admin
   and install the app on a Jira Cloud site.
2. **Panel.** Open any Jira issue, click the hexagon
   ("View app actions") and choose **Triage Copilot**. The panel shows
   the DoD checklist, severity with evidence, suggested assignee, and
   possible duplicates. Click **Apply triage…** to see the preview,
   then Confirm.
3. **Rovo agent.** In Jira, open Rovo chat ("Ask Rovo") and type
   `Triage PLAT-33510` (or any issue key). The agent presents the same
   triage and asks for confirmation before applying anything. Needs a
   site with Rovo enabled.
4. **MCP server.** In Atlassian Administration → Connected apps →
   triage-copilot → Tools, click **Enable tools**. Then connect any MCP
   client to `https://mcp.atlassian.com/forge/1146f277-7b1f-4320-a0f8-19ad51c9ccb8`
   and call `score-severity` on an issue key — it returns the same
   score as the panel.

## License

MIT — see `LICENSE`. Built during Codegeist 2026
(27 Oct – 22 Dec 2026).
