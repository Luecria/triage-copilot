// Read a Jira issue through the Forge API, as the user who is asking.
// Everything the triage steps need comes from this one read: summary,
// description, type, priority, status, assignee, reporter, components,
// labels, estimate, parent link, watchers, links, and recent comments.
//
// All calls run asUser(), so Jira permissions apply — the app only ever
// sees what the asking user is allowed to see.
const api = require('@forge/api');
const { route } = require('@forge/api');
const { adfToText } = require('./text');

// The story-points custom field id differs per site. customfield_10016 is
// the id Jira uses on most company-managed projects; we also accept a time
// tracking estimate as a fallback, so the DoD "estimate present" check does
// not depend on one field id being right.
const STORY_POINTS_FIELD = 'customfield_10016';

// Fields pulled for the issue read. `comment` is requested so the recent
// commenters are available for the assignee signals without a second call.
const ISSUE_FIELDS = [
  'summary',
  'description',
  'issuetype',
  'priority',
  'status',
  'assignee',
  'reporter',
  'components',
  'labels',
  'parent',
  'watches',
  'issuelinks',
  'timetracking',
  STORY_POINTS_FIELD,
  'comment',
  'created',
  'updated',
].join(',');

// Fetch one issue by key and return a plain, triage-ready object.
// Throws a clear error when the key is missing or Jira does not return the
// issue (unknown key, or the user cannot see it).
async function getIssue(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('getIssue: issueKey is required, e.g. PROJ-123');
  }
  const key = issueKey.trim().toUpperCase();
  const response = await api.asUser().requestJira(
    route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `getIssue: Jira returned ${response.status} for ${key}. ${body.slice(0, 200)}`,
    );
  }
  const raw = await response.json();
  const f = raw.fields || {};

  // Recent comments, newest first, capped — used for assignee signals.
  const comments = (f.comment && Array.isArray(f.comment.comments)
    ? f.comment.comments
    : []
  )
    .slice(-10)
    .reverse()
    .map((c) => ({
      id: c.id,
      authorAccountId: c.author && c.author.accountId,
      authorDisplayName: c.author && c.author.displayName,
      created: c.created,
      bodyText: adfToText(c.body),
    }));

  // Story points: the site default field, or null when the site uses a
  // different custom field id for it.
  const storyPoints =
    typeof f[STORY_POINTS_FIELD] === 'number' ? f[STORY_POINTS_FIELD] : null;

  return {
    id: raw.id,
    key: raw.key,
    summary: f.summary || '',
    descriptionAdf: f.description || null,
    descriptionText: adfToText(f.description),
    type: f.issuetype ? f.issuetype.name : null,
    priority: f.priority ? f.priority.name : null,
    status: f.status ? f.status.name : null,
    assignee: f.assignee
      ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName }
      : null,
    reporter: f.reporter
      ? { accountId: f.reporter.accountId, displayName: f.reporter.displayName }
      : null,
    components: (f.components || []).map((c) => c.name),
    labels: f.labels || [],
    parentKey: f.parent ? f.parent.key : null,
    watchCount: f.watches ? f.watches.watchCount || 0 : 0,
    // Issue links, kept with their direction so severity can tell
    // "blocks others" apart from "is blocked by".
    links: (f.issuelinks || []).map((l) => ({
      type: l.type ? l.type.name : null,
      outwardKey: l.outwardIssue ? l.outwardIssue.key : null,
      inwardKey: l.inwardIssue ? l.inwardIssue.key : null,
    })),
    storyPoints,
    estimateSeconds:
      f.timetracking && typeof f.timetracking.originalEstimateSeconds === 'number'
        ? f.timetracking.originalEstimateSeconds
        : null,
    projectKey: key.split('-')[0],
    created: f.created,
    updated: f.updated,
    comments,
  };
}

module.exports = { getIssue, STORY_POINTS_FIELD };
