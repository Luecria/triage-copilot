// Teamwork Graph client (Preview API, 15 Oct 2026).
//
// One call (twg) plus a paged reader (twgAll). Rules from the measured
// Codegeist tutorial and the Phase 1 notes:
//   - Every query carries an operation name shaped [company]_[operation]
//     (ours: triagecopilot_*). Without it the API answers HTTP 200 with a
//     DataFetchingException — a res.ok check alone would pass, so a call
//     only counts as good with data AND no errors.
//   - Page size 25 (requesting more returns an error), max 4 pages by
//     default. When paging stops early, the result reports complete: false.
//   - Transient errors (rate limit / 429 / 502 / 503 / 504) are retried up
//     to 3 times with backoff (~200 ms doubling, capped at 1.2 s + jitter).
//   - "Empty + errors" means "could not read" — never "nothing there".
//     A rate-limited call can come back with zero rows, not an error.
//   - Calls run through api.asUser().requestTeamworkGraph — the only
//     supported path; calling as the app is undocumented.
//   - IDs are ARIs: user ari:cloud:identity::user/{accountId}, work item
//     ari:cloud:jira:{cloudId}:issue/{issueId}.
//
// Curated-query field names follow the Phase 1 notes; they must be verified
// against the live TWG schema downloaded from a real site in Phase 3. The
// parsing below is defensive: an unexpected shape yields "could not read",
// never a crash.
const api = require('@forge/api');

const PAGE_SIZE = 25;
const MAX_PAGES = 4;
const MAX_RETRIES = 3;

// A result is only usable when the GraphQL body has data and no errors.
function isUsable(body) {
  return (
    body &&
    typeof body === 'object' &&
    body.data &&
    typeof body.data === 'object' &&
    !body.errors
  );
}

// Transient = worth retrying. Anything else (bad query, missing scope,
// bad operation name) fails fast instead of burning retries.
function isTransient(error) {
  const message = String((error && error.message) || error || '').toLowerCase();
  return (
    message.includes('rate_limit') ||
    message.includes('throttle') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One Teamwork Graph call. Returns { ok, data, errors } — ok is true only
// when the body has data and no errors. Retries transient failures.
async function twg(operationName, query, variables) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await api
        .asUser()
        .requestTeamworkGraph(query, variables);
      const body = await response.json().catch(() => null);
      if (isUsable(body)) {
        return { ok: true, data: body.data, errors: null };
      }
      // A 200 with GraphQL errors is a real failure, not a transient one
      // (bad operation name, bad field, missing scope) — do not retry.
      const message =
        body && Array.isArray(body.errors) && body.errors[0]
          ? body.errors[0].message || 'Teamwork Graph returned errors'
          : `Teamwork Graph returned HTTP ${response.status}`;
      return { ok: false, data: body && body.data ? body.data : null, errors: message };
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === MAX_RETRIES) {
        break;
      }
      // Backoff: ~200 ms doubling, capped at 1.2 s, plus jitter.
      const delay = Math.min(1200, 200 * 2 ** attempt) + Math.random() * 100;
      await sleep(delay);
    }
  }
  return {
    ok: false,
    data: null,
    errors: lastError ? String(lastError.message || lastError) : 'Teamwork Graph call failed',
  };
}

// Pull a Relay connection field out of a response body, tolerating the two
// shapes the API uses: a connection object ({ edges, pageInfo }) or a plain
// array. Returns { items, hasNextPage, endCursor }.
function readConnection(fieldValue) {
  if (!fieldValue) return { items: [], hasNextPage: false, endCursor: null };
  if (Array.isArray(fieldValue)) {
    return { items: fieldValue, hasNextPage: false, endCursor: null };
  }
  const edges = Array.isArray(fieldValue.edges) ? fieldValue.edges : [];
  const items = edges.map((e) => (e && e.node ? e.node : e)).filter(Boolean);
  const pageInfo = fieldValue.pageInfo || {};
  return {
    items,
    hasNextPage: Boolean(pageInfo.hasNextPage),
    endCursor: pageInfo.endCursor || null,
  };
}

// Paged reader: walks a connection field up to MAX_PAGES pages.
// Returns { items, complete, readable }. readable is false when the read
// failed or came back empty with errors — callers must report "could not
// read", never "nothing there". complete is false when paging stopped early
// (more pages exist than we fetched, or a page failed mid-walk).
async function twgAll(operationName, query, variables, fieldName) {
  const items = [];
  let after = null;
  let complete = true;
  let readable = true;
  let errorDetail = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await twg(operationName, query, {
      ...variables,
      first: PAGE_SIZE,
      after,
    });
    if (!result.ok) {
      // Empty + errors: could not read. A failed page also means the walk
      // is incomplete — we did not see everything.
      readable = false;
      complete = false;
      errorDetail = result.errors;
      break;
    }
    const { items: pageItems, hasNextPage, endCursor } = readConnection(
      result.data[fieldName],
    );
    items.push(...pageItems);
    if (!hasNextPage || !endCursor) {
      break;
    }
    after = endCursor;
    if (page === MAX_PAGES - 1) {
      // More pages exist than we are willing to fetch.
      complete = false;
    }
  }

  return { items, complete, readable, errors: errorDetail };
}

// --- Curated queries (field names per the Phase 1 notes) -----------------
// Each query is a root field with a Relay connection shape. The node fields
// requested are the smallest set the assignee ranking needs.

const ASSIGNED_WORK_QUERY = `
  query triagecopilot_assignedWork($userId: ID!, $first: Int, $after: String) {
    atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first, after: $after) {
      edges {
        node {
          ... on JiraWorkItem {
            id
            key
            summary
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const USER_TEAMS_QUERY = `
  query triagecopilot_userTeams($userId: ID!, $first: Int, $after: String) {
    atlassianUserInTeams(userId: $userId, first: $first, after: $after) {
      edges {
        node {
          ... on AtlassianTeam {
            id
            displayName
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const TEAM_MEMBERS_QUERY = `
  query triagecopilot_teamMembers($teamAri: ID!, $first: Int, $after: String) {
    atlassianTeamMembers(teamAri: $teamAri, first: $first, after: $after) {
      edges {
        node {
          ... on AtlassianUser {
            id
            accountId
            name
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const WORK_ITEM_COMMENTS_QUERY = `
  query triagecopilot_workItemComments($workItemId: ID!, $first: Int, $after: String) {
    jiraWorkItemComments(id: $workItemId, first: $first, after: $after) {
      edges {
        node {
          ... on JiraWorkItemComment {
            id
            author {
              id
              name
            }
            createdAt
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const WORK_ITEM_GOALS_QUERY = `
  query triagecopilot_workItemGoals($workItemId: ID!) {
    jiraWorkItemGoals(id: $workItemId) {
      edges {
        node {
          ... on AtlassianGoal {
            id
            name
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Convenience wrappers. Each returns the twgAll shape
// { items, complete, readable, errors }.
function assignedWorkItems(userId) {
  return twgAll(
    'triagecopilot_assignedWork',
    ASSIGNED_WORK_QUERY,
    { userId },
    'atlassianUserAssignedJiraWorkItems',
  );
}

function userTeams(userId) {
  return twgAll(
    'triagecopilot_userTeams',
    USER_TEAMS_QUERY,
    { userId },
    'atlassianUserInTeams',
  );
}

function teamMembers(teamAri) {
  return twgAll(
    'triagecopilot_teamMembers',
    TEAM_MEMBERS_QUERY,
    { teamAri },
    'atlassianTeamMembers',
  );
}

function workItemComments(workItemId) {
  return twgAll(
    'triagecopilot_workItemComments',
    WORK_ITEM_COMMENTS_QUERY,
    { workItemId },
    'jiraWorkItemComments',
  );
}

async function workItemGoals(workItemId) {
  const result = await twg(
    'triagecopilot_workItemGoals',
    WORK_ITEM_GOALS_QUERY,
    { workItemId },
  );
  if (!result.ok) {
    return { items: [], complete: false, readable: false, errors: result.errors };
  }
  const { items } = readConnection(result.data.jiraWorkItemGoals);
  return { items, complete: true, readable: true, errors: null };
}

// Build a user ARI from a Jira accountId.
function userAri(accountId) {
  return `ari:cloud:identity::user/${accountId}`;
}

module.exports = {
  twg,
  twgAll,
  assignedWorkItems,
  userTeams,
  teamMembers,
  workItemComments,
  workItemGoals,
  userAri,
  PAGE_SIZE,
  MAX_PAGES,
};
