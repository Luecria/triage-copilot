// Duplicate detection — SUPPORTING feature only.
//
// Two stages: a JQL text search on the summary keywords finds candidates,
// then token-overlap similarity (Jaccard) on the normalized summary +
// description scores them. Thresholds: >= 0.80 "likely duplicate",
// 0.50–0.80 "possibly related". Below 0.50 is dropped.
//
// This is deliberately shown last in every surface (panel, agent, MCP).
// Candidates are linked, never auto-closed.
const api = require('@forge/api');
const { route } = require('@forge/api');
const { getIssue } = require('./jira');
const { tokenize, jaccardSimilarity } = require('./text');

const LIKELY_THRESHOLD = 0.8;
const RELATED_THRESHOLD = 0.5;

// Find possible duplicates of one issue. Returns the candidates sorted by
// similarity, highest first, with their label.
async function findSimilarIssues(issueKey) {
  const issue = await getIssue(issueKey);
  const targetTokens = tokenize(`${issue.summary} ${issue.descriptionText}`);

  // Keywords for the JQL text search: up to 8 tokens from the summary.
  const keywords = [...tokenize(issue.summary)].slice(0, 8);
  let candidates = [];
  if (keywords.length > 0) {
    const jql =
      `project = ${issue.projectKey} AND text ~ "${keywords.join(' ')}" ` +
      `AND key != ${issue.key} ORDER BY updated DESC`;
    const response = await api.asUser().requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&fields=summary,description&maxResults=20`,
      { headers: { Accept: 'application/json' } },
    );
    if (response.ok) {
      const body = await response.json().catch(() => null);
      candidates = (body && body.issues) || [];
    }
  }

  const { adfToText } = require('./text');
  const scored = candidates
    .map((c) => {
      const f = c.fields || {};
      const candidateTokens = tokenize(
        `${f.summary || ''} ${adfToText(f.description)}`,
      );
      const similarity = jaccardSimilarity(targetTokens, candidateTokens);
      return {
        key: c.key,
        summary: f.summary || '',
        similarity: Math.round(similarity * 100) / 100,
        label:
          similarity >= LIKELY_THRESHOLD
            ? 'likely duplicate'
            : similarity >= RELATED_THRESHOLD
              ? 'possibly related'
              : 'not similar',
      };
    })
    .filter((c) => c.similarity >= RELATED_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  return {
    issueKey: issue.key,
    keywords,
    candidates: scored,
    thresholds: { likely: LIKELY_THRESHOLD, related: RELATED_THRESHOLD },
  };
}

module.exports = { findSimilarIssues, LIKELY_THRESHOLD, RELATED_THRESHOLD };
