// Full-triage orchestrator, used by the issue panel resolver.
//
// Runs the five steps in the product order — DoD checklist, severity,
// assignee, then possible duplicates last — and composes the suggested
// comment text the panel prefills in the Apply preview.
//
// Each step is isolated: if one step fails (e.g. Teamwork Graph is
// unreachable), the rest still return and the failure is reported in the
// result instead of killing the whole triage. The individual action
// handlers (src/index.js) do the opposite — they let the error propagate,
// because a single action should fail loudly.
const { getIssue } = require('./jira');
const { getDodChecklist } = require('./dod');
const { scoreSeverity } = require('./severity');
const { suggestAssignee } = require('./assignee');
const { findSimilarIssues } = require('./dedupe');

// Compose the triage summary the Apply preview prefills as the comment.
function buildComment(issue, dod, severity, assignee, similar) {
  const lines = [];
  lines.push('Triage Copilot summary');
  lines.push('');
  lines.push(
    `Definition of done: ${dod.summary.passed} of ${dod.summary.total} passed` +
      (dod.summary.ready ? ' — ready to work on.' : ' — NOT ready yet.'),
  );
  for (const item of dod.items) {
    if (item.status === 'fail') {
      lines.push(`- Missing: ${item.label} (${item.field}).`);
    }
  }
  lines.push('');
  lines.push(`Severity: ${severity.band} (${severity.score}/100).`);
  for (const e of severity.evidence) {
    lines.push(`- ${e.signal}: +${e.points} — ${e.detail}`);
  }
  lines.push('');
  if (assignee.candidates.length > 0) {
    const top = assignee.candidates[0];
    lines.push(
      `Suggested assignee: ${top.displayName} (score ${top.score}).`,
    );
    for (const reason of top.reasons) {
      lines.push(`- ${reason}`);
    }
  } else {
    lines.push('Suggested assignee: none found.');
  }
  if (assignee.incomplete) {
    lines.push('Note: assignee data may be incomplete — a source could not be read.');
  }
  if (similar.candidates.length > 0) {
    lines.push('');
    lines.push('Possible duplicates (supporting information only):');
    for (const c of similar.candidates) {
      lines.push(`- ${c.key} (${c.label}, similarity ${c.similarity}): ${c.summary}`);
    }
  }
  return lines.join('\n');
}

async function runTriage(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('runTriage: issueKey is required, e.g. PROJ-123');
  }
  const key = issueKey.trim().toUpperCase();
  const issue = await getIssue(key);

  const result = {
    issueKey: key,
    issue: {
      summary: issue.summary,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      assignee: issue.assignee,
      reporter: issue.reporter,
      components: issue.components,
      labels: issue.labels,
    },
    dod: null,
    severity: null,
    assignee: null,
    similar: null,
    stepErrors: [],
    suggestedComment: '',
  };

  // 1. Definition of done — first, always.
  try {
    result.dod = await getDodChecklist(key);
  } catch (error) {
    result.stepErrors.push({ step: 'dod', error: String(error.message || error) });
  }

  // 2. Severity.
  try {
    result.severity = await scoreSeverity(key);
  } catch (error) {
    result.stepErrors.push({ step: 'severity', error: String(error.message || error) });
  }

  // 3. Assignee (Teamwork Graph + Jira signals).
  try {
    result.assignee = await suggestAssignee(key);
  } catch (error) {
    result.stepErrors.push({ step: 'assignee', error: String(error.message || error) });
    result.assignee = { candidates: [], unreadable: [String(error.message || error)], incomplete: true };
  }

  // 4. Possible duplicates — last, supporting only.
  try {
    result.similar = await findSimilarIssues(key);
  } catch (error) {
    result.stepErrors.push({ step: 'similar', error: String(error.message || error) });
    result.similar = { candidates: [], keywords: [] };
  }

  // Suggested comment, only when the three leading steps all returned.
  if (result.dod && result.severity && result.assignee && result.similar) {
    result.suggestedComment = buildComment(
      issue,
      result.dod,
      result.severity,
      result.assignee,
      result.similar,
    );
  }

  return result;
}

module.exports = { runTriage, buildComment };
