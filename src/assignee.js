// Assignee suggestion (Teamwork Graph + Jira signals).
//
// Ranks up to three candidates with a reason for each. Signals, in order:
//   1. Prior work on the same component or labels (Jira JQL: past assignees
//      of similar issues).
//   2. Recent activity on this issue or similar issues (recent commenters,
//      recent assignees).
//   3. Team membership from Teamwork Graph (reporter's teams -> members).
//   4. Current open workload from Teamwork Graph (fewer open items = more
//      available).
//
// Never auto-assigns: the result is a proposal. The apply step only assigns
// the person the user explicitly chose. When a Teamwork Graph source could
// not be read, the result says so and falls back to the Jira signals —
// "could not read", never "nothing there".
const api = require('@forge/api');
const { route } = require('@forge/api');
const { getIssue } = require('./jira');
const twg = require('./twg');

// How far back "recent" reaches for commenter / assignee activity.
const RECENT_DAYS = 90;

// JQL needs double-quoted literals; escape any double quotes inside.
function jqlQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// Past assignees of issues in the same project sharing a component or a
// label, most recently updated first. Returns a map accountId -> {
// displayName, count, lastUpdated }.
async function pastAssignees(projectKey, components, labels, excludeKey) {
  const clauses = [];
  if (components.length > 0) {
    clauses.push(
      `component in (${components.map(jqlQuote).join(', ')})`,
    );
  }
  if (labels.length > 0) {
    clauses.push(`labels in (${labels.map(jqlQuote).join(', ')})`);
  }
  if (clauses.length === 0) return new Map();
  const jql =
    `project = ${projectKey} AND (${clauses.join(' OR ')}) ` +
    `AND assignee is not EMPTY AND key != ${excludeKey} ` +
    `ORDER BY updated DESC`;
  const response = await api.asUser().requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&fields=assignee,updated&maxResults=20`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) return new Map();
  const body = await response.json().catch(() => null);
  const issues = (body && body.issues) || [];
  const byAccount = new Map();
  for (const issue of issues) {
    const assignee = issue.fields && issue.fields.assignee;
    if (!assignee || !assignee.accountId) continue;
    const entry = byAccount.get(assignee.accountId) || {
      accountId: assignee.accountId,
      displayName: assignee.displayName,
      count: 0,
      lastUpdated: null,
    };
    entry.count += 1;
    if (!entry.lastUpdated || issue.fields.updated > entry.lastUpdated) {
      entry.lastUpdated = issue.fields.updated;
    }
    byAccount.set(assignee.accountId, entry);
  }
  return byAccount;
}

// Extract the accountId from a Teamwork Graph user ARI
// (ari:cloud:identity::user/{accountId}).
function accountIdFromAri(ari) {
  if (!ari || typeof ari !== 'string') return null;
  const parts = ari.split('/');
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function daysAgo(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86400000;
}

// Rank assignee candidates for one issue. Returns the top 3 with reasons,
// plus which sources were readable (so the panel/agent can say the answer
// may be incomplete when a source failed).
async function suggestAssignee(issueKey) {
  const issue = await getIssue(issueKey);
  const unreadable = [];

  // Candidate pool: accountId -> { accountId, displayName, signals }.
  const candidates = new Map();
  function addCandidate(accountId, displayName, signal, detail) {
    if (!accountId) return;
    const entry = candidates.get(accountId) || {
      accountId,
      displayName: displayName || accountId,
      signals: [],
    };
    entry.signals.push({ signal, detail });
    candidates.set(accountId, entry);
  }

  // 1. Teamwork Graph: the reporter's teams, then their members.
  // The reporter's team usually owns the area the issue is about.
  let teamMemberIds = new Set();
  if (issue.reporter && issue.reporter.accountId) {
    const teams = await twg.userTeams(twg.userAri(issue.reporter.accountId));
    if (!teams.readable) {
      unreadable.push(
        'Teamwork Graph: reporter teams could not be read.' +
          (teams.errors ? ` (${teams.errors})` : ''),
      );
    } else {
      for (const team of teams.items) {
        const members = await twg.teamMembers(team.id);
        if (!members.readable) {
          unreadable.push(
            `Teamwork Graph: members of team ${team.displayName || team.id} could not be read.` +
              (members.errors ? ` (${members.errors})` : ''),
          );
          continue;
        }
        for (const member of members.items) {
          const accountId = member.accountId || accountIdFromAri(member.id);
          if (accountId) {
            teamMemberIds.add(accountId);
            addCandidate(
              accountId,
              member.name,
              'team',
              `Member of ${team.displayName || 'the reporter’s team'}.`,
            );
          }
        }
      }
    }
  }

  // 2. Recent commenters on this issue (Jira comments, last 90 days).
  // Someone who already discussed the issue knows the context.
  for (const comment of issue.comments) {
    if (daysAgo(comment.created) <= RECENT_DAYS) {
      addCandidate(
        comment.authorAccountId,
        comment.authorDisplayName,
        'commenter',
        `Commented on this issue ${new Date(comment.created).toISOString().slice(0, 10)}.`,
      );
    }
  }

  // 3. Past assignees of the same component / labels (Jira JQL).
  const past = await pastAssignees(
    issue.projectKey,
    issue.components,
    issue.labels,
    issue.key,
  );
  for (const entry of past.values()) {
    addCandidate(
      entry.accountId,
      entry.displayName,
      'component',
      `Assigned to ${entry.count} similar issue(s) before.`,
    );
  }

  // The current assignee (if any) is not a candidate for reassignment.
  if (issue.assignee) candidates.delete(issue.assignee.accountId);

  // First ranking pass on the cheap signals, so workload lookups (one TWG
  // call per person) only run for the top 5.
  const scored = [...candidates.values()].map((c) => {
    let score = 0;
    const reasons = [];
    const pastEntry = past.get(c.accountId);
    if (pastEntry) {
      // Prior same-component work: up to 9 points.
      const points = Math.min(9, pastEntry.count * 3);
      score += points;
      reasons.push(
        `Worked on ${pastEntry.count} similar issue(s) (${points} pts).`,
      );
      if (daysAgo(pastEntry.lastUpdated) <= 30) {
        score += 2;
        reasons.push('Recently active on similar issues (+2).');
      }
    }
    if (c.signals.some((s) => s.signal === 'commenter')) {
      score += 4;
      reasons.push('Commented on this issue recently (+4).');
    }
    if (teamMemberIds.has(c.accountId)) {
      score += 2;
      reasons.push('On the reporter’s team (+2).');
    }
    return { ...c, score, reasons };
  });
  scored.sort((a, b) => b.score - a.score);
  const shortlist = scored.slice(0, 5);

  // Second pass: current open workload from Teamwork Graph. Fewer open
  // items means more available: up to 10 points for an empty plate.
  for (const candidate of shortlist) {
    const work = await twg.assignedWorkItems(twg.userAri(candidate.accountId));
    if (!work.readable) {
      unreadable.push(
        `Teamwork Graph: workload for ${candidate.displayName} could not be read.` +
          (work.errors ? ` (${work.errors})` : ''),
      );
      candidate.openCount = null;
      candidate.reasons.push('Workload unknown — could not be read.');
      continue;
    }
    // The assigned-work query returns the person's items; treat the
    // returned count as their open load (the query is scoped to work
    // assigned to them). When paging stopped early, say so.
    candidate.openCount = work.items.length;
    const availability = Math.max(0, 10 - work.items.length);
    candidate.score += availability;
    candidate.reasons.push(
      `${work.items.length} open item(s) assigned (${availability} pts availability)` +
        (work.complete ? '.' : ' — list may be incomplete.'),
    );
  }

  shortlist.sort((a, b) => b.score - a.score);
  const top = shortlist.slice(0, 3).map((c) => ({
    accountId: c.accountId,
    displayName: c.displayName,
    score: c.score,
    openCount: c.openCount,
    reasons: c.reasons,
  }));

  return {
    issueKey: issue.key,
    candidates: top,
    unreadable,
    incomplete: unreadable.length > 0,
  };
}

module.exports = { suggestAssignee };
