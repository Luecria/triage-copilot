# Privacy Policy — Triage Copilot

**Last updated:** 12 November 2026
**Developer:** Mandala Putra
**Contact:** uplee4ever18@gmail.com

## What Triage Copilot does

Triage Copilot is a Forge app for Jira. It helps teams triage Jira issues by
showing a definition-of-done checklist, a severity score, an assignee
suggestion, and possible duplicate issues. It also exposes the same
capabilities to Rovo (Atlassian's AI assistant) and to MCP-compatible clients.

## Data the app accesses

When you run a triage, the app reads the following from your Jira site,
through the Jira and Teamwork Graph APIs, acting as the signed-in user:

- Issue fields (summary, description, type, status, priority, assignee,
  reporter, labels, components, story points, time tracking, parent link,
  issue links, comments).
- Teamwork Graph data used only to suggest an assignee: the reporter's
  teams, team members, and the number of open items assigned to a candidate.

## Data the app stores

**None.** Triage Copilot does not store, copy, or retain any personal data
or issue content on its own servers. There is no database, no analytics,
and no logging of issue content. Every triage is computed on demand and
the result is shown only to the user who requested it.

## Data shared with third parties

**None.** The app does not send your data to any third party. It only
calls Atlassian's own APIs (Jira and Teamwork Graph) from within the
Atlassian Forge runtime.

## Permissions

The app requests only the scopes it needs to read Jira work and Teamwork
Graph data and to write a triage comment or issue link when you explicitly
confirm an apply action. It never writes anything without your confirmation.

## Changes

If this policy changes, the updated version will be posted here with a new
"Last updated" date.

## Contact

Questions about this policy: uplee4ever18@gmail.com.
