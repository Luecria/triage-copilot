// apply-triage — the ONLY write path in the app, confirmation-gated.
//
// Four layers (see ARCHITECTURE.md §4):
//   1. The agent prompt never writes — it proposes and asks.
//   2. Contract gate: this function requires confirmed: true in its inputs.
//      Without it, it errors BEFORE any Jira call is made.
//   3. Dedupe safety net: immediately before writing, similarity is
//      re-checked. A candidate at >= 0.80 that the user did NOT confirm is
//      held back (not linked) and reported, instead of being written.
//   4. asUser + audit: every write runs as the user who confirmed, so Jira
//      permissions apply and the change is attributed to them.
//
// What it writes, in order: the chosen assignee (or nothing, when the user
// leaves it unassigned), the triage summary as a comment, and links for the
// confirmed duplicates. Likely duplicates (>= 0.80) link as "Duplicate";
// possibly related ones (0.50–0.80) link as "Relates".
const api = require('@forge/api');
const { route } = require('@forge/api');
const { textToAdf } = require('./text');
const { getIssue } = require('./jira');
const { findSimilarIssues, LIKELY_THRESHOLD } = require('./dedupe');

async function applyTriage(input) {
  const {
    issueKey,
    assigneeAccountId,
    comment,
    duplicateKeys,
    confirmedDuplicateKeys,
    confirmed,
  } = input || {};

  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('applyTriage: issueKey is required, e.g. PROJ-123');
  }
  const key = issueKey.trim().toUpperCase();

  // Layer 2 — contract gate. No confirmation, no Jira calls at all.
  if (confirmed !== true) {
    throw new Error(
      'applyTriage: confirmed must be true. Show the user the exact preview ' +
        'of what will be written and ask them to confirm before calling this.',
    );
  }

  // Normalize a duplicate-key input: accept an array, a single string,
  // or a comma-separated string. Rovo infers parameter names from the
  // action description (no inputs schema), so it may pass only one of
  // the two duplicate lists, or a single string instead of an array.
  // Handle all of those.
  const toKeyList = (v) => {
    if (Array.isArray(v)) {
      return v
        .flatMap((k) => String(k).split(','))
        .map((k) => k.trim().toUpperCase())
        .filter(Boolean);
    }
    if (typeof v === 'string' && v.trim()) {
      return v
        .split(',')
        .map((k) => k.trim().toUpperCase())
        .filter(Boolean);
    }
    return [];
  };
  let confirmedList = toKeyList(confirmedDuplicateKeys);
  let requestedList = toKeyList(duplicateKeys);
  // Fallback: the user confirmed the whole triage (confirmed === true)
  // after seeing the preview that listed these duplicates, so keys passed
  // in only one list count as confirmed. The similarity re-check below
  // is still the real safety net.
  if (confirmedList.length === 0 && requestedList.length > 0) {
    confirmedList = requestedList;
  }
  if (requestedList.length === 0 && confirmedList.length > 0) {
    requestedList = confirmedList;
  }
  // Only link keys the user explicitly confirmed.
  const toLink = requestedList.filter((k) => confirmedList.includes(k));

  // Layer 3 — dedupe safety net: re-check similarity right before writing.
  // A candidate that crossed the 0.80 threshold since the read, and was not
  // confirmed, is held back and reported instead of written.
  const heldBack = [];
  const linkable = [];
  if (toLink.length > 0) {
    const fresh = await findSimilarIssues(key);
    const freshByKey = new Map(fresh.candidates.map((c) => [c.key, c]));
    for (const dupKey of toLink) {
      const candidate = freshByKey.get(dupKey);
      if (candidate && candidate.similarity >= LIKELY_THRESHOLD) {
        linkable.push({ key: dupKey, linkType: 'Duplicate' });
      } else if (candidate) {
        // Still similar, but below the duplicate threshold — link as
        // related instead of as a duplicate.
        linkable.push({ key: dupKey, linkType: 'Relates' });
      } else {
        // No longer similar enough to show up at all. The user confirmed
        // it earlier, so link it as related rather than dropping it
        // silently — and say so in the report.
        linkable.push({ key: dupKey, linkType: 'Relates' });
      }
    }
    // Anything at >= 0.80 that was NOT confirmed is held back.
    for (const candidate of fresh.candidates) {
      if (
        candidate.similarity >= LIKELY_THRESHOLD &&
        !confirmedList.includes(candidate.key)
      ) {
        heldBack.push({
          key: candidate.key,
          summary: candidate.summary,
          similarity: candidate.similarity,
          reason: 'Likely duplicate (similarity >= 0.80) that was not in the confirmed list.',
        });
      }
    }
  }

  // Layer 4 — writes, all asUser.
  const applied = { assignee: null, commentId: null, links: [] };
  const warnings = [];

  // 1. Assignee (only when the user chose one).
  if (assigneeAccountId) {
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${key}/assignee`,
      {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: assigneeAccountId }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `applyTriage: assigning ${key} failed with HTTP ${res.status}. ${body.slice(0, 200)}`,
      );
    }
    applied.assignee = assigneeAccountId;
  }

  // 2. Triage summary as a comment (only when there is text to post).
  if (comment && String(comment).trim()) {
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${key}/comment`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: textToAdf(String(comment).trim()) }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `applyTriage: posting the comment on ${key} failed with HTTP ${res.status}. ${body.slice(0, 200)}`,
      );
    }
    const created = await res.json().catch(() => null);
    applied.commentId = created ? created.id : null;
  }

  // 3. Duplicate / related links.
  //
  // Direction rule for "Duplicate": the NEWER issue is the duplicate and
  // the OLDER issue is the original — regardless of which issue's panel (or
  // Rovo chat) the apply was triggered from. The old code assumed the
  // current issue was always the duplicate, so applying from the ORIGINAL
  // issue's panel wrote the link backwards ("original duplicates
  // duplicate"). We compare the two issues' `created` dates and put the
  // newer one as the inward issue and the older one as the outward issue,
  // so the link always reads "<newer> duplicates <older>".
  // "Relates" is symmetric, so its direction does not matter.
  // A link of the same type that already exists between the two issues is
  // skipped (and reported) instead of created a second time.
  let currentIssue = null;
  if (linkable.length > 0) {
    try {
      currentIssue = await getIssue(key);
    } catch (e) {
      warnings.push(
        `Could not re-read ${key} before linking: ${e.message}. Links use the default direction (current issue is the duplicate).`,
      );
    }
  }
  for (const link of linkable) {
    // Skip if the same type of link already exists between the two issues
    // (in either direction). A link between two issues shows up on both
    // of them, so reading the current issue is enough.
    const alreadyLinked =
      currentIssue &&
      (currentIssue.links || []).some(
        (l) =>
          l.type === link.linkType &&
          (l.outwardKey === link.key || l.inwardKey === link.key),
      );
    if (alreadyLinked) {
      warnings.push(
        `Link to ${link.key} (${link.linkType}) already exists — skipped instead of creating a second one.`,
      );
      continue;
    }

    // Direction for "Duplicate": the newer issue is the duplicate
    // (inward), the older issue is the original (outward).
    let inwardKey = key;
    let outwardKey = link.key;
    if (link.linkType === 'Duplicate' && currentIssue && currentIssue.created) {
      try {
        const targetIssue = await getIssue(link.key);
        const currentCreated = new Date(currentIssue.created).getTime();
        const targetCreated = new Date(targetIssue.created).getTime();
        if (!Number.isNaN(currentCreated) && !Number.isNaN(targetCreated)) {
          if (targetCreated > currentCreated) {
            // Target is newer, so the target is the duplicate.
            inwardKey = link.key;
            outwardKey = key;
          }
          // Current issue newer (or equal): the default order
          // (inward = current, outward = target) is already correct.
        }
      } catch (e) {
        warnings.push(
          `Could not read ${link.key} to decide the duplicate direction: ${e.message}. Using the default direction (current issue is the duplicate).`,
        );
      }
    }

    const res = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: link.linkType },
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      warnings.push(
        `Link to ${link.key} (${link.linkType}) failed with HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
      continue;
    }
    applied.links.push({ key: link.key, linkType: link.linkType });
  }

  return {
    issueKey: key,
    applied,
    heldBack,
    warnings,
  };
}

module.exports = { applyTriage };
