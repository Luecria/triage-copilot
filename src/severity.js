// Severity scoring (deterministic rules, 0–100 + band + evidence).
//
// Every point is explained: each contributing signal lands in the evidence
// list with the points it added and the value observed, so the panel and the
// agent can show why the issue scored what it did. Rovo may adjust the
// score by at most ±10 with a stated reason; the rule score and the reason
// are both shown (calibration), never the adjusted score alone.
//
// Bands: Critical ≥ 80, High ≥ 60, Medium ≥ 40, Low < 40.
const { getIssue } = require('./jira');

// Wording in the summary or description that signals a live breakage.
const OUTAGE_WORDS = [
  'outage',
  'down',
  'broken',
  'crash',
  'data loss',
  'security',
  'vulnerability',
  'breach',
  'unavailable',
  'not working',
];

const PRIORITY_POINTS = {
  Highest: 30,
  High: 20,
  Medium: 10,
  Low: 0,
  Lowest: 0,
};

const TYPE_POINTS = {
  Incident: 25,
  Bug: 20,
  Story: 5,
  Task: 5,
  Epic: 0,
};

function bandFor(score) {
  if (score >= 80) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

// Score one issue. Returns the rule score, the band, and the evidence.
async function scoreSeverity(issueKey) {
  const issue = await getIssue(issueKey);
  let score = 0;
  const evidence = [];

  // 1. Issue type — an incident or a bug starts higher than a story.
  const typePoints = TYPE_POINTS[issue.type] || 0;
  if (typePoints > 0) {
    score += typePoints;
    evidence.push({
      signal: 'issue type',
      points: typePoints,
      detail: `Type is ${issue.type}.`,
    });
  }

  // 2. Priority — the reporter's own urgency signal.
  const priorityPoints = PRIORITY_POINTS[issue.priority] || 0;
  if (priorityPoints > 0) {
    score += priorityPoints;
    evidence.push({
      signal: 'priority',
      points: priorityPoints,
      detail: `Priority is ${issue.priority}.`,
    });
  }

  // 3. Blocking links — an issue that blocks others hurts more than one
  // that only blocks itself; being blocked by another adds a little.
  const blocksOthers = issue.links.filter(
    (l) => l.type === 'Blocks' && l.outwardKey,
  ).length;
  const blockedBy = issue.links.filter(
    (l) => l.type === 'Blocks' && l.inwardKey,
  ).length;
  if (blocksOthers > 0) {
    score += 15;
    evidence.push({
      signal: 'blocks others',
      points: 15,
      detail: `Blocks ${blocksOthers} other issue(s).`,
    });
  }
  if (blockedBy > 0) {
    score += 5;
    evidence.push({
      signal: 'blocked by',
      points: 5,
      detail: `Blocked by ${blockedBy} other issue(s).`,
    });
  }

  // 4. Watchers — more people watching usually means more people hurt.
  if (issue.watchCount >= 5) {
    score += 10;
    evidence.push({
      signal: 'watchers',
      points: 10,
      detail: `${issue.watchCount} watchers.`,
    });
  } else if (issue.watchCount >= 2) {
    score += 5;
    evidence.push({
      signal: 'watchers',
      points: 5,
      detail: `${issue.watchCount} watchers.`,
    });
  }

  // 5. Outage wording — "down", "broken", "crash" and friends in the
  // summary or description.
  const haystack = `${issue.summary} ${issue.descriptionText}`.toLowerCase();
  const hit = OUTAGE_WORDS.find((w) => haystack.includes(w));
  if (hit) {
    score += 15;
    evidence.push({
      signal: 'outage wording',
      points: 15,
      detail: `Mentions "${hit}".`,
    });
  }

  // 6. Component breadth — a bug touching many components has a wider
  // blast radius than one touching a single component.
  if (issue.components.length >= 3) {
    score += 10;
    evidence.push({
      signal: 'component breadth',
      points: 10,
      detail: `Touches ${issue.components.length} components.`,
    });
  } else if (issue.components.length === 2) {
    score += 5;
    evidence.push({
      signal: 'component breadth',
      points: 5,
      detail: 'Touches 2 components.',
    });
  }

  // 7. Age without update — an issue untouched for weeks is either stale
  // (low urgency) or neglected (higher urgency). We score it as neglected
  // only when the issue is still open, which it is by definition here.
  if (issue.updated) {
    const daysStale = Math.floor(
      (Date.now() - new Date(issue.updated).getTime()) / 86400000,
    );
    if (daysStale > 30) {
      score += 10;
      evidence.push({
        signal: 'stale',
        points: 10,
        detail: `No update for ${daysStale} days.`,
      });
    } else if (daysStale > 14) {
      score += 5;
      evidence.push({
        signal: 'stale',
        points: 5,
        detail: `No update for ${daysStale} days.`,
      });
    }
  }

  // Clamp to 0–100.
  score = Math.max(0, Math.min(100, score));

  return {
    issueKey: issue.key,
    score,
    band: bandFor(score),
    evidence,
  };
}

module.exports = { scoreSeverity, bandFor };
