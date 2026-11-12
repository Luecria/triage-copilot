// Definition-of-done checklist (deterministic rules).
//
// Seven checks, each with a verdict — pass, fail, or n/a — and the field it
// checked, so the panel and the agent can name exactly what is missing.
// The checklist is the first thing the triage shows: a failing item means
// the issue is not ready to work on, whatever else the triage finds.
const { getIssue } = require('./jira');

// Words that signal an acceptance-criteria section in the description.
const ACCEPTANCE_MARKERS = [
  'acceptance criteria',
  'acceptance test',
  'definition of done',
  'done when',
  'expected result',
  'expected behaviour',
  'expected behavior',
];

// Words that signal reproduction steps in a bug report.
const REPRO_MARKERS = [
  'steps to reproduce',
  'steps to repro',
  'repro steps',
  'how to reproduce',
  'reproduction steps',
];

function textHas(text, markers) {
  const haystack = String(text || '').toLowerCase();
  return markers.some((m) => haystack.includes(m));
}

// Compute the checklist for one issue. Returns the items plus a summary
// count, so callers can show "4 of 6 passed" at a glance.
async function getDodChecklist(issueKey) {
  const issue = await getIssue(issueKey);
  const isBug = (issue.type || '').toLowerCase() === 'bug';
  const isEpic = (issue.type || '').toLowerCase() === 'epic';
  const description = issue.descriptionText || '';
  const summary = issue.summary || '';

  const items = [
    {
      id: 'acceptance-criteria',
      label: 'Acceptance criteria present',
      // The criteria live in the description (or, rarely, the summary).
      status: textHas(description, ACCEPTANCE_MARKERS) ||
        textHas(summary, ACCEPTANCE_MARKERS)
        ? 'pass'
        : 'fail',
      field: 'description',
      detail:
        textHas(description, ACCEPTANCE_MARKERS) ||
        textHas(summary, ACCEPTANCE_MARKERS)
          ? 'Description names what "done" looks like.'
          : 'No acceptance criteria in the description.',
    },
    {
      id: 'assignee-set',
      label: 'Assignee set',
      status: issue.assignee ? 'pass' : 'fail',
      field: 'assignee',
      detail: issue.assignee
        ? `Assigned to ${issue.assignee.displayName}.`
        : 'No one owns this issue yet.',
    },
    {
      id: 'priority-set',
      label: 'Priority set',
      status: issue.priority ? 'pass' : 'fail',
      field: 'priority',
      detail: issue.priority
        ? `Priority is ${issue.priority}.`
        : 'Priority is empty.',
    },
    {
      id: 'estimate-present',
      label: 'Estimate present',
      // Story points on the site default field, or a time tracking
      // estimate — either one counts as "estimated".
      status:
        issue.storyPoints !== null || issue.estimateSeconds !== null
          ? 'pass'
          : 'fail',
      field: 'story points / time tracking',
      detail:
        issue.storyPoints !== null
          ? `Story points: ${issue.storyPoints}.`
          : issue.estimateSeconds !== null
            ? `Original estimate: ${Math.round(issue.estimateSeconds / 3600)}h.`
            : 'No story points and no time estimate.',
    },
    {
      id: 'parent-epic-linked',
      label: 'Parent / epic linked',
      // Epics sit at the top of the hierarchy, so the check does not
      // apply to them; every other type should have a parent link.
      status: isEpic ? 'n/a' : issue.parentKey ? 'pass' : 'fail',
      field: 'parent',
      detail: isEpic
        ? 'Epics have no parent by definition.'
        : issue.parentKey
          ? `Parent: ${issue.parentKey}.`
          : 'No parent or epic link.',
    },
    {
      id: 'repro-steps',
      label: 'Reproduction steps present',
      // Only bugs need repro steps; other types get n/a.
      status: !isBug
        ? 'n/a'
        : textHas(description, REPRO_MARKERS)
          ? 'pass'
          : 'fail',
      field: 'description',
      detail: !isBug
        ? 'Only bug reports need reproduction steps.'
        : textHas(description, REPRO_MARKERS)
          ? 'Description lists how to reproduce it.'
          : 'No reproduction steps in the description.',
    },
    {
      id: 'labels-components',
      label: 'Labels or components set',
      status:
        issue.labels.length > 0 || issue.components.length > 0
          ? 'pass'
          : 'fail',
      field: 'labels / components',
      detail:
        issue.labels.length > 0 || issue.components.length > 0
          ? `Labels: ${issue.labels.join(', ') || 'none'}; components: ${issue.components.join(', ') || 'none'}.`
          : 'No labels and no components — the issue is hard to find later.',
    },
  ];

  const applicable = items.filter((i) => i.status !== 'n/a');
  const passed = applicable.filter((i) => i.status === 'pass').length;
  const failed = applicable.filter((i) => i.status === 'fail');

  return {
    issueKey: issue.key,
    items,
    summary: {
      passed,
      failed: failed.length,
      total: applicable.length,
      ready: failed.length === 0,
    },
  };
}

module.exports = { getDodChecklist };
