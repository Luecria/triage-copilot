// Function handlers for the Triage Copilot Forge app.
//
// Two kinds of entry points live here:
//   - Action handlers (one per `action` module in manifest.yml). Rovo and
//     MCP call these. The event IS the action input; a single action fails
//     loudly when its input is bad or its read fails.
//   - The panel resolver (`panelResolver`), used by the UI Kit issue panel
//     through invoke(). It runs the full triage in one call and tolerates a
//     single step failing (see src/triage.js).
//
// Every read and write runs asUser() inside the modules below, so Jira
// permissions apply and nothing is ever written as the app.
const Resolver = require('@forge/resolver').default;
const { getIssue } = require('./jira');
const { getDodChecklist } = require('./dod');
const { scoreSeverity } = require('./severity');
const { suggestAssignee } = require('./assignee');
const { findSimilarIssues } = require('./dedupe');
const { applyTriage } = require('./apply');
const { runTriage } = require('./triage');

// Action inputs can arrive in a few shapes depending on the caller (Rovo
// passes the inputs object directly; other paths nest it under payload,
// input, or a JSON body). Normalise to the flat inputs object.
function readInput(event) {
  if (!event || typeof event !== 'object') return {};
  if (typeof event.issueKey === 'string') return event;
  if (event.payload && typeof event.payload === 'object') return event.payload;
  if (event.input && typeof event.input === 'object') return event.input;
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (e) {
      return {};
    }
  }
  return event;
}

function requireIssueKey(input) {
  const key = input && input.issueKey;
  if (!key || typeof key !== 'string') {
    throw new Error('issueKey is required, e.g. PROJ-123');
  }
  return key;
}

// --- Action handlers -------------------------------------------------------

async function getIssueHandler(event) {
  const input = readInput(event);
  return getIssue(requireIssueKey(input));
}

async function getDodChecklistHandler(event) {
  const input = readInput(event);
  return getDodChecklist(requireIssueKey(input));
}

async function scoreSeverityHandler(event) {
  const input = readInput(event);
  return scoreSeverity(requireIssueKey(input));
}

async function suggestAssigneeHandler(event) {
  const input = readInput(event);
  return suggestAssignee(requireIssueKey(input));
}

async function findSimilarIssuesHandler(event) {
  const input = readInput(event);
  return findSimilarIssues(requireIssueKey(input));
}

async function applyTriageHandler(event) {
  const input = readInput(event);
  return applyTriage(input);
}

// --- Panel resolver --------------------------------------------------------

const resolver = new Resolver();

resolver.define('getTriage', async ({ payload }) => {
  const input = payload || {};
  return runTriage(requireIssueKey(input));
});

resolver.define('applyTriage', async ({ payload }) => {
  return applyTriage(payload || {});
});

module.exports = {
  getIssue: getIssueHandler,
  getDodChecklist: getDodChecklistHandler,
  scoreSeverity: scoreSeverityHandler,
  suggestAssignee: suggestAssigneeHandler,
  findSimilarIssues: findSimilarIssuesHandler,
  applyTriage: applyTriageHandler,
  panelResolver: resolver.getDefinitions(),
};
