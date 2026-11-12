// Triage Copilot — Jira issue panel (UI Kit 2, @forge/react).
//
// Order on screen, matching the product positioning: DoD checklist first,
// severity + evidence, assignee top 3 with reasons, possible duplicates
// last, then the Apply button. The Apply button opens a preview modal
// showing exactly what will be written (assignee, comment, duplicate
// links); only the Confirm button inside the modal calls apply-triage
// with confirmed: true.
//
// Data comes from the panel resolver (invoke('getTriage')) and writes go
// through invoke('applyTriage'). Both run as the user.
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  List,
  ListItem,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Text,
  TextArea,
  useProductContext,
} from '@forge/react';
// React (default) + hooks come from 'react', NOT from '@forge/react' — that
// package does not export useState/useEffect, so importing them from there
// yields undefined and crashes the panel on first render (blank skeleton
// forever). The default React import is also required: the JSX in this file
// compiles to React.createElement calls, so without `React` in scope the
// bundle throws "React is not defined" and nothing renders. This matches the
// official Forge jira-issue-panel-ui-kit template.
import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

// Lozenge colours for the severity bands.
const BAND_APPEARANCE = {
  Critical: 'removed',
  High: 'moved',
  Medium: 'new',
  Low: 'success',
};

// Lozenge colours for a DoD item verdict.
const DOD_APPEARANCE = {
  pass: 'success',
  fail: 'removed',
  'n/a': 'default',
};

function App() {
  const context = useProductContext();
  const issueKey =
    (context && context.extension && context.extension.issue && context.extension.issue.key) ||
    null;

  const [triage, setTriage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Apply-preview state.
  const [showPreview, setShowPreview] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [commentText, setCommentText] = useState('');
  const [checkedDuplicates, setCheckedDuplicates] = useState({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [applyError, setApplyError] = useState(null);

  // Load the triage once the issue key is known.
  useEffect(() => {
    if (!issueKey) return;
    setLoading(true);
    setError(null);
    invoke('getTriage', { issueKey })
      .then((result) => {
        setTriage(result);
        setLoading(false);
        // Prefill the preview from the fresh triage.
        if (result && result.assignee && result.assignee.candidates.length > 0) {
          setSelectedAssignee(result.assignee.candidates[0].accountId);
        } else {
          setSelectedAssignee('');
        }
        setCommentText((result && result.suggestedComment) || '');
        const checked = {};
        if (result && result.similar) {
          for (const c of result.similar.candidates) {
            // Likely duplicates are checked by default; possibly related
            // ones are listed unchecked so the user opts in.
            checked[c.key] = c.similarity >= 0.8;
          }
        }
        setCheckedDuplicates(checked);
      })
      .catch((e) => {
        setError(String((e && e.message) || e));
        setLoading(false);
      });
  }, [issueKey]);

  // Confirm button inside the preview modal — the only path that writes.
  async function confirmApply() {
    if (!triage) return;
    setApplying(true);
    setApplyError(null);
    const duplicateKeys = Object.keys(checkedDuplicates).filter(
      (k) => checkedDuplicates[k],
    );
    try {
      const result = await invoke('applyTriage', {
        issueKey,
        assigneeAccountId: selectedAssignee || undefined,
        comment: commentText,
        duplicateKeys,
        confirmedDuplicateKeys: duplicateKeys,
        confirmed: true,
      });
      setApplyResult(result);
      setShowPreview(false);
      setApplying(false);
      // Reload so the panel shows the new assignee.
      const fresh = await invoke('getTriage', { issueKey });
      setTriage(fresh);
    } catch (e) {
      setApplyError(String((e && e.message) || e));
      setApplying(false);
    }
  }

  if (!context) {
    return (
      <Stack space="space.100">
        <Spinner size="medium" />
        <Text>Loading Triage Copilot…</Text>
      </Stack>
    );
  }

  if (!issueKey) {
    return (
      <SectionMessage appearance="warning" title="No issue found">
        <Text>Triage Copilot could not determine which issue this panel is on.</Text>
      </SectionMessage>
    );
  }

  if (loading) {
    return (
      <Stack space="space.100">
        <Spinner size="medium" />
        <Text>Running triage on {issueKey}…</Text>
      </Stack>
    );
  }

  if (error || !triage) {
    return (
      <Stack space="space.100">
        <SectionMessage appearance="error" title="Triage failed">
          <Text>{error || 'No triage result returned.'}</Text>
        </SectionMessage>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Stack>
    );
  }

  const dod = triage.dod;
  const severity = triage.severity;
  const assignee = triage.assignee || { candidates: [], unreadable: [], incomplete: false };
  const similar = triage.similar || { candidates: [] };

  // Assignee options for the preview Select: top 3, plus "leave unassigned".
  const assigneeOptions = [
    { label: 'Leave unassigned', value: '' },
    ...assignee.candidates.map((c) => ({
      label: `${c.displayName} (score ${c.score})`,
      value: c.accountId,
    })),
  ];

  return (
    <Stack space="space.200">
      <Heading size="medium">Triage Copilot</Heading>
      <Text>
        {triage.issue.summary} — {triage.issue.type} · {triage.issue.status}
      </Text>

      {/* 1. Definition of done — first. */}
      {dod && (
        <Box>
          <Heading size="small">
            Definition of done — {dod.summary.passed} of {dod.summary.total} passed
          </Heading>
          {!dod.summary.ready && (
            <SectionMessage appearance="warning" title="Not ready yet">
              <Text>
                {dod.summary.failed} checklist item(s) failing. The issue is not
                ready to work on until they are fixed.
              </Text>
            </SectionMessage>
          )}
          <DynamicTable
            head={{
              cells: [
                { key: 'check', content: 'Check' },
                { key: 'status', content: 'Status' },
                { key: 'field', content: 'Field checked' },
              ],
            }}
            rows={dod.items.map((item) => ({
              key: item.id,
              cells: [
                { key: 'check', content: item.label },
                {
                  key: 'status',
                  content: (
                    <Lozenge appearance={DOD_APPEARANCE[item.status] || 'default'}>
                      {item.status}
                    </Lozenge>
                  ),
                },
                { key: 'field', content: `${item.field} — ${item.detail}` },
              ],
            }))}
          />
        </Box>
      )}

      {/* 2. Severity + evidence. */}
      {severity && (
        <Box>
          <Heading size="small">Severity</Heading>
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={BAND_APPEARANCE[severity.band] || 'default'}>
              {severity.band}
            </Lozenge>
            <Text>
              <Strong>{severity.score}/100</Strong> (rule score)
            </Text>
          </Inline>
          <List>
            {severity.evidence.map((e, i) => (
              <ListItem key={i}>
                <Text>
                  {e.signal}: +{e.points} — {e.detail}
                </Text>
              </ListItem>
            ))}
            {severity.evidence.length === 0 && (
              <ListItem>
                <Text>No severity signals fired — a plain issue.</Text>
              </ListItem>
            )}
          </List>
        </Box>
      )}

      {/* 3. Assignee top 3 with reasons. */}
      <Box>
        <Heading size="small">Suggested assignee</Heading>
        {assignee.incomplete && (
          <SectionMessage appearance="warning" title="Assignee data may be incomplete">
            <Text>
              {(assignee.unreadable || []).join(' ')} The suggestions below use
              only the sources that could be read.
            </Text>
          </SectionMessage>
        )}
        {assignee.candidates.length === 0 ? (
          <Text>No assignee candidates found.</Text>
        ) : (
          <List>
            {assignee.candidates.map((c) => (
              <ListItem key={c.accountId}>
                <Text>
                  <Strong>
                    {c.displayName} (score {c.score})
                  </Strong>
                </Text>
                {c.reasons.map((r, i) => (
                  <Text key={i}>— {r}</Text>
                ))}
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* 4. Possible duplicates — last, supporting only. */}
      <Box>
        <Heading size="small">Possible duplicates</Heading>
        {similar.candidates.length === 0 ? (
          <Text>No likely duplicates found.</Text>
        ) : (
          <List>
            {similar.candidates.map((c) => (
              <ListItem key={c.key}>
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance={c.similarity >= 0.8 ? 'removed' : 'new'}>
                    {c.label}
                  </Lozenge>
                  <Text>
                    {c.key} — similarity {c.similarity}
                  </Text>
                </Inline>
                <Text>{c.summary}</Text>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* Step errors, if any single step failed. */}
      {triage.stepErrors && triage.stepErrors.length > 0 && (
        <SectionMessage appearance="warning" title="Some triage steps failed">
          {triage.stepErrors.map((s, i) => (
            <Text key={i}>
              {s.step}: {s.error}
            </Text>
          ))}
        </SectionMessage>
      )}

      {/* Apply result. */}
      {applyResult && (
        <SectionMessage appearance="confirmation" title="Triage applied">
          <Text>
            {applyResult.applied.assignee
              ? `Assignee set. `
              : ''}
            {applyResult.applied.commentId ? `Comment posted. ` : ''}
            {applyResult.applied.links.length > 0
              ? `Linked: ${applyResult.applied.links.map((l) => `${l.key} (${l.linkType})`).join(', ')}. `
              : ''}
            {applyResult.heldBack.length > 0
              ? `Held back (not confirmed): ${applyResult.heldBack.map((h) => h.key).join(', ')}.`
              : ''}
          </Text>
        </SectionMessage>
      )}
      {applyError && (
        <SectionMessage appearance="error" title="Apply failed">
          <Text>{applyError}</Text>
        </SectionMessage>
      )}

      {/* Apply button — opens the preview, writes nothing by itself. */}
      <Button appearance="primary" onClick={() => setShowPreview(true)}>
        Apply triage…
      </Button>

      {/* Preview modal: exactly what will be written, before confirming. */}
      <ModalTransition>
        {showPreview && (
          <Modal onClose={() => setShowPreview(false)}>
            <ModalHeader>
              <ModalTitle>Apply triage to {issueKey}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.200">
                <Text>
                  This is exactly what will be written. Nothing is applied
                  until you press Confirm.
                </Text>
                <Text>
                  <Strong>Assignee</Strong>
                </Text>
                <Select
                  name="assignee"
                  options={assigneeOptions}
                  value={assigneeOptions.find((o) => o.value === selectedAssignee)}
                  onChange={(option) =>
                    setSelectedAssignee(option ? option.value : '')
                  }
                />
                <Text>
                  <Strong>Comment to post</Strong>
                </Text>
                <TextArea
                  name="comment"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                />
                {similar.candidates.length > 0 && (
                  <Box>
                    <Text>
                      <Strong>Link as duplicate / related</Strong>
                    </Text>
                    {similar.candidates.map((c) => (
                      <Checkbox
                        key={c.key}
                        name={`dup-${c.key}`}
                        label={`${c.key} — ${c.label} (${c.similarity}): ${c.summary}`}
                        isChecked={Boolean(checkedDuplicates[c.key])}
                        onChange={(e) =>
                          setCheckedDuplicates((prev) => ({
                            ...prev,
                            [c.key]: e.target.checked,
                          }))
                        }
                      />
                    ))}
                  </Box>
                )}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setShowPreview(false)}>Cancel</Button>
              <LoadingButton
                appearance="primary"
                isLoading={applying}
                onClick={confirmApply}
              >
                Confirm and apply
              </LoadingButton>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
