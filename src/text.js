// Text helpers: Atlassian Document Format (ADF) <-> plain text.
//
// Jira stores rich text (descriptions, comments) as ADF, a nested JSON
// document. The deterministic checks in this app (DoD, severity, dedupe)
// work on plain text, so we flatten ADF first. When we write a comment
// back to Jira we build a small ADF document from plain text instead.

// Flatten an ADF document (or a plain string, or null) to plain text.
// Walks every node recursively and joins text nodes with spaces, so a
// heading, a paragraph, and a list all contribute their words.
function adfToText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  if (typeof adf !== 'object') return '';
  // A text node carries the words directly.
  if (adf.type === 'text' && typeof adf.text === 'string') return adf.text;
  // Any other node: recurse into its content array, if it has one.
  if (Array.isArray(adf.content)) {
    return adf.content.map(adfToText).filter(Boolean).join(' ');
  }
  return '';
}

// Build a minimal ADF document from plain text, so a comment posted to
// Jira renders as paragraphs. Blank lines split paragraphs; each line
// inside a paragraph stays on its own line via a hardBreak.
function textToAdf(text) {
  const paragraphs = String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const content = paragraphs.length
    ? paragraphs.map((paragraph) => ({
        type: 'paragraph',
        content: paragraph.split('\n').flatMap((line, i) => {
          const textNode = { type: 'text', text: line.trim() };
          // A hardBreak between lines of the same paragraph.
          return i === 0 ? [textNode] : [{ type: 'hardBreak' }, textNode];
        }),
      }))
    : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }];
  return { type: 'doc', version: 1, content };
}

// Normalise free text into a token set for similarity scoring: lowercase,
// split on anything that is not a letter or digit, drop stopwords and
// tokens shorter than 3 characters.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'when', 'then',
  'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'you',
  'your', 'our', 'their', 'they', 'them', 'its', 'can', 'should',
  'would', 'could', 'will', 'into', 'about', 'after', 'before',
  'there', 'here', 'which', 'what', 'how', 'why', 'who', 'also',
  'been', 'being', 'over', 'under', 'more', 'than', 'then', 'very',
]);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

// Jaccard similarity between two token sets: shared tokens divided by all
// distinct tokens. Returns 0 when either set is empty.
function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

module.exports = { adfToText, textToAdf, tokenize, jaccardSimilarity };
