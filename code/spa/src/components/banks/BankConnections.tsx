import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link';
import { api, type BankConnection, type BankQuarantineItem, type MigrationReview, type PlaidAccountSuggestion, type PlaidLinkAttempt, type ReconciliationMatch } from '@/lib/api';
import type { Account } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const ATTEMPT_KEY = 'doughray:plaid-link';

function MatchSearch({ connectionId, batchId, candidateId, label, disabled, onSelect }: {
  connectionId: string; batchId: string; candidateId: string; label: string; disabled: boolean; onSelect: (match: ReconciliationMatch) => void;
}) {
  const [term, setTerm] = useState('');
  const [result, setResult] = useState<{ matches: Array<ReconciliationMatch & { updatedAt: string }>; hasMore: boolean; page: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const search = async (page: number) => {
    setSearching(true); setError('');
    try { setResult((await api.searchBankMatches(connectionId, batchId, candidateId, term, page)).data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to search transactions.'); }
    finally { setSearching(false); }
  };
  const include = async (match: ReconciliationMatch & { updatedAt: string }) => {
    setSearching(true); setError('');
    try { onSelect((await api.includeBankMatch(connectionId, batchId, candidateId, match)).data); setResult(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to select this match.'); }
    finally { setSearching(false); }
  };
  return <div className="space-y-2 rounded-md border p-2">
    <div className="flex gap-2">
      <input aria-label={`Search older matches for ${label}`} value={term} onChange={(event) => setTerm(event.target.value)}
        placeholder="Search description or payee" className="min-w-0 flex-1 rounded-md border bg-background p-2" />
      <Button variant="outline" size="sm" disabled={disabled || searching} onClick={() => void search(1)}>Search matches</Button>
    </div>
    <p className="text-xs text-muted-foreground">Searches this account for the same amount and currency, including other dates.</p>
    {error && <p role="alert">{error}</p>}
    {result && <div className="space-y-1">
      {result.matches.length === 0 && <p>No matches found.</p>}
      {result.matches.map((match) => <div key={match.id} className="flex items-center justify-between gap-2">
        <span>{match.posted.slice(0, 10)} · {match.amount} · {match.description}</span>
        <Button variant="outline" size="sm" disabled={disabled || searching} onClick={() => void include(match)}>Use match</Button>
      </div>)}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={disabled || searching || result.page <= 1} onClick={() => void search(result.page - 1)}>Previous</Button>
        <span>Page {result.page}</span>
        <Button variant="outline" size="sm" disabled={disabled || searching || !result.hasMore} onClick={() => void search(result.page + 1)}>Next</Button>
      </div>
    </div>}
  </div>;
}

function LinkLauncher({ attempt, onSuccess, onExit }: {
  attempt: PlaidLinkAttempt;
  onSuccess: (token: string | null, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: () => void;
}) {
  const opened = useRef(false);
  const redirected = new URLSearchParams(window.location.search).has('oauth_state_id');
  const { open, ready, error } = usePlaidLink({
    token: attempt.linkToken,
    ...(redirected ? { receivedRedirectUri: window.location.href } : {}),
    onSuccess,
    onExit,
  });
  useEffect(() => { if (ready && !opened.current) { opened.current = true; open(); } }, [open, ready]);
  if (error) return <p role="alert">Could not load Plaid Link. Check your connection and try again.</p>;
  return <p className="text-sm text-muted-foreground">Opening secure bank connection…</p>;
}

export function BankConnections() {
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [configured, setConfigured] = useState(false);
  const [refreshEnabled, setRefreshEnabled] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<PlaidLinkAttempt | null>(() => {
    if (!new URLSearchParams(window.location.search).has('oauth_state_id')) return null;
    try { return JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || 'null') as PlaidLinkAttempt | null; } catch { return null; }
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PlaidAccountSuggestion[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [localAccounts, setLocalAccounts] = useState<Account[]>([]);
  const [review, setReview] = useState<MigrationReview | null>(null);
  const [quarantineConnection, setQuarantineConnection] = useState<string | null>(null);
  const [quarantine, setQuarantine] = useState<BankQuarantineItem[]>([]);
  const [repairs, setRepairs] = useState<Record<string, { amount?: string; date?: string; name?: string; currency?: string }>>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retryLink, setRetryLink] = useState<{ token: string | null; metadata: PlaidLinkOnSuccessMetadata } | null>(null);

  const refresh = useCallback(async () => {
    const response = await api.bankConnections();
    setConnections(response.data.connections);
    setConfigured(response.data.config.plaid.configured);
    setRefreshEnabled(response.data.config.plaid.refreshEnabled);
    setIssues(response.data.config.issues);
  }, []);
  useEffect(() => { void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load connections.')); }, [refresh]);

  const showAccounts = async (id: string) => {
    const [response, local] = await Promise.all([api.bankAccounts(id), api.getAccounts()]);
    setAccounts(response.data.accounts);
    setLocalAccounts(local.data);
    setChoices({});
    setSelected(id);
    setReview(null);
  };

  const showReview = async (id: string) => {
    const response = await api.bankReview(id);
    setSelected(id); setReview(response.data);
    setDecisions(Object.fromEntries((response.data?.cases ?? []).flatMap((item) => item.draft.map((draft) =>
      [draft.candidateId, draft.action === 'NEW_TRANSACTION' ? 'new' : draft.transactionId ?? '']))));
    setMessage(response.data ? '' : 'History is still loading or there is no review pending.');
  };

  const showQuarantine = async (id: string) => {
    const response = await api.bankQuarantine(id);
    setQuarantineConnection(id); setQuarantine(response.data); setRepairs({});
  };

  const startLink = async (mode: 'NEW' | 'UPDATE', connectionId?: string) => {
    setBusy(true); setMessage('');
    try {
      const { data } = await api.plaidLinkToken(mode, connectionId);
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(data));
      setAttempt(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to open Plaid Link.'); }
    finally { setBusy(false); }
  };

  const onLinkSuccess = async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
    if (!attempt) return;
    setRetryLink({ token: publicToken, metadata });
    setBusy(true); setMessage('');
    try {
      let id = attempt.connectionId;
      if (attempt.mode === 'NEW') {
        if (!publicToken) throw new Error('Plaid did not return a connection token.');
        const result = await api.plaidExchange(attempt.attemptId, publicToken, metadata.institution?.name, metadata.institution?.institution_id);
        id = result.data.connection.id;
      } else if (id) await api.plaidLinkComplete(id, attempt.attemptId);
      sessionStorage.removeItem(ATTEMPT_KEY); setAttempt(null);
      setRetryLink(null);
      if (new URLSearchParams(window.location.search).has('oauth_state_id')) window.history.replaceState(null, '', window.location.pathname);
      await refresh();
      if (id) await showAccounts(id);
      setMessage('Bank connected. Choose accounts to add.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to finish connecting the bank.'); }
    finally { setBusy(false); }
  };

  const saveAccounts = async () => {
    if (!selected) return;
    const mappings = accounts.filter((account) => choices[account.externalAccountId] && !account.mappedAccountSourceId)
      .map((account) => choices[account.externalAccountId] === 'ignore'
        ? { externalAccountId: account.externalAccountId, action: 'IGNORE' as const }
        : choices[account.externalAccountId] === 'new'
        ? { externalAccountId: account.externalAccountId, action: 'CREATE' as const }
        : { externalAccountId: account.externalAccountId, action: 'MAP' as const, accountId: choices[account.externalAccountId] });
    if (!mappings.length) return;
    setBusy(true); setMessage('');
    try { await api.mapBankAccounts(selected, mappings); await showAccounts(selected); await refresh(); setMessage('Accounts mapped. Existing-account imports will wait for your history review.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to add accounts.'); }
    finally { setBusy(false); }
  };

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage('');
    try { await operation(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The bank operation failed.'); }
    finally { setBusy(false); }
  };

  const syncNow = async (id: string) => {
    await run(async () => {
      const { data } = await api.syncBank(id);
      for (let i = 0; i < 90; i++) {
        const job = (await api.getSyncJob(data.jobId)).data;
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.errorMessage || 'Sync did not complete.');
        if (job.status === 'SUCCEEDED') return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('Sync is still running. Check again later.');
    }, 'Sync finished. Review history if required.');
  };

  const refreshFromBank = async (id: string) => {
    await run(async () => {
      const { data } = await api.refreshBank(id);
      for (let i = 0; i < 90; i++) {
        const job = (await api.getSyncJob(data.jobId)).data;
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.errorMessage || 'Bank refresh did not complete.');
        if (job.status === 'SUCCEEDED') return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('Bank refresh is still running. Check again later.');
    }, 'Bank refresh requested. New transactions may take time to arrive.');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><CardTitle>Bank connections</CardTitle><CardDescription>Connect and manage Plaid banks</CardDescription></div>
          <Button disabled={busy || !configured || !!attempt} onClick={() => void startLink('NEW')}>Connect bank</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && <p className="text-sm text-muted-foreground">Plaid is not ready: {issues.join(' ')}</p>}
        {attempt && <LinkLauncher attempt={attempt} onSuccess={(token, metadata) => void onLinkSuccess(token, metadata)} onExit={() => {
          sessionStorage.removeItem(ATTEMPT_KEY); setAttempt(null); setRetryLink(null);
          if (new URLSearchParams(window.location.search).has('oauth_state_id')) window.history.replaceState(null, '', window.location.pathname);
        }} />}
        {retryLink && <Button variant="outline" size="sm" disabled={busy} onClick={() => void onLinkSuccess(retryLink.token, retryLink.metadata)}>Retry finishing connection</Button>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {connections.filter((connection) => connection.provider === 'PLAID').map((connection) => (
          <div key={connection.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2"><span className="font-medium">{connection.institutionName || 'Bank connection'}</span>
              <Badge variant="secondary">{connection.pausedAt ? 'Paused' : connection.status}</Badge></div>
            <p className="text-xs text-muted-foreground">History: {connection.transactionsHistoryState || 'waiting'}
              {connection.lastSuccessfulSyncAt ? ` · Last sync: ${new Date(connection.lastSuccessfulSyncAt).toLocaleString()}` : ''}</p>
            {connection.healthDetail && <p className="text-sm">{connection.healthDetail}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void showAccounts(connection.id).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load accounts.'))}>Accounts</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void showReview(connection.id).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load review.'))}>Review history</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void showQuarantine(connection.id).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load sync issues.'))}>Sync issues</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => {
                const undo = (await api.bankUndoable(connection.id)).data;
                if (!undo) throw new Error('No published switch is available to undo.');
                if (!window.confirm(`Undo the most recent switch for ${undo.accounts} account(s)? SimpleFin updates can resume for those accounts.`)) throw new Error('Undo cancelled.');
                await api.undoBankReview(connection.id, undo.batchId);
              }, 'Switch undone. SimpleFin updates can resume.')}>Undo switch</Button>
              <Button variant="outline" size="sm" disabled={busy || !!connection.pausedAt} onClick={() => void syncNow(connection.id)}>Sync now</Button>
              {refreshEnabled && <Button variant="outline" size="sm" disabled={busy || !!connection.pausedAt} onClick={() => void refreshFromBank(connection.id)}>Refresh from bank</Button>}
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void startLink('UPDATE', connection.id)}>Reconnect</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api.pauseBank(connection.id, !connection.pausedAt), connection.pausedAt ? 'Connection resumed.' : 'Connection paused.')}>{connection.pausedAt ? 'Resume' : 'Pause'}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                if (window.confirm('Disconnect this bank? Your existing transaction history will be kept.')) void run(async () => {
                  const response = await api.disconnectBank(connection.id);
                  if (response.data.retriable) throw new Error('Bank disconnect failed; retry to complete it.');
                }, 'Bank disconnected.');
              }}>Disconnect</Button>
            </div>
          </div>
        ))}
        {quarantineConnection && <div className="space-y-3 rounded-md border p-3">
          <h3 className="font-medium">Sync issues</h3>
          <p className="text-sm text-muted-foreground">The bank update remains unpublished until invalid records are corrected. Leave a field empty to keep the bank value, or retry without changes after the bank corrects it. Plaid amounts are positive for expenses and negative for income.</p>
          {quarantine.length === 0 && <p className="text-sm">No open sync issues.</p>}
          {quarantine.map((item) => <div key={item.id} className="space-y-2 border-t pt-3">
            <p className="text-sm">{item.reason} · {item.status === 'REPLAYING' ? 'Retry queued' : 'Needs review'}</p>
            <p className="text-sm">Bank record: {String(item.record?.name ?? 'Unnamed')} · {String(item.record?.date ?? 'date unavailable')} · {String(item.record?.amount ?? 'amount unavailable')} {String(item.record?.iso_currency_code ?? '')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['amount', 'date', 'name', 'currency'] as const).map((field) => <label key={field} className="text-sm">Corrected {field}
                <input className="block w-full rounded-md border bg-background p-2" disabled={busy || item.status !== 'OPEN'}
                  value={repairs[item.id]?.[field] ?? ''} onChange={(event) => setRepairs((current) => ({ ...current,
                    [item.id]: { ...current[item.id], [field]: event.target.value } }))} />
              </label>)}
            </div>
            <Button variant="outline" size="sm" disabled={busy || item.status !== 'OPEN'} onClick={() => void run(async () => {
              const edit = repairs[item.id] ?? {};
              const amount = edit.amount?.trim() ? Number(edit.amount) : undefined;
              if (amount !== undefined && !Number.isFinite(amount)) throw new Error('Enter a valid corrected amount.');
              await api.replayBankQuarantine(quarantineConnection, item.id, {
                ...(amount !== undefined ? { amount } : {}), ...(edit.date?.trim() ? { date: edit.date.trim() } : {}),
                ...(edit.name?.trim() ? { name: edit.name.trim() } : {}), ...(edit.currency?.trim() ? { iso_currency_code: edit.currency.trim() } : {}),
              });
              await showQuarantine(quarantineConnection);
            }, 'Retry queued.')}>Retry sync</Button>
          </div>)}
        </div>}
        {selected && !review && <div className="space-y-3 rounded-md border p-3">
          <h3 className="font-medium">Map bank accounts</h3>
          <p className="text-sm text-muted-foreground">Choose an existing account to preserve its history, create a new one, or exclude an account. Existing accounts pause SimpleFin updates until you review the Plaid history. Choose an action for every returned account to enable sync. Once sync advances, excluded accounts cannot be mapped to this connection without losing history; link them separately instead.</p>
          {accounts.length === 0 && <p className="text-sm">No accounts are available yet.</p>}
          {accounts.map((account) => <label key={account.externalAccountId} className="block space-y-1 text-sm">
            <span>{account.name}{account.mask ? ` · ${account.mask}` : ''}{account.mappedAccountSourceId ? ' (mapped)' : ''}{account.ignored ? ' (excluded)' : ''}{!account.currency ? ' (currency unavailable)' : ''}{account.currentBalance === null ? ' (balance unavailable)' : ''}</span>
            {!account.mappedAccountSourceId && <select aria-label={`Mapping for ${account.name}`} value={choices[account.externalAccountId] ?? ''}
              onChange={(event) => setChoices((current) => ({ ...current, [account.externalAccountId]: event.target.value }))}
              className="block w-full rounded-md border bg-background p-2">
              <option value="">Choose later</option><option value="ignore">Do not import this account</option>
              <option value="new" disabled={!account.currency || account.currentBalance === null}>Create a new account</option>
              {localAccounts.filter((local) => local.currency === account.currency).map((local) => <option key={local.id} value={local.id}>Existing: {local.name} ({local.type})</option>)}
            </select>}
          </label>)}
          <Button size="sm" disabled={busy || !Object.values(choices).some(Boolean)} onClick={() => void saveAccounts()}>Save account mappings</Button>
        </div>}
        {selected && review && <div className="space-y-3 rounded-md border p-3">
          <h3 className="font-medium">Review imported history</h3>
          <p className="text-sm text-muted-foreground">For each Plaid transaction, choose its matching existing transaction or confirm that it is new. Suggestions cover up to 100 transactions within three days; search can find matches on other dates. Existing categories and review decisions are retained.</p>
          {review.cases.map((item) => <div key={item.id} className="space-y-3">
            <h4 className="font-medium">{item.accountName}</h4>
            {item.candidates.map((candidate) => <div key={candidate.id} className="block space-y-1 text-sm">
              <label htmlFor={`match-${candidate.id}`}>{candidate.evidence.change.postedDate} · {candidate.evidence.change.amount} {candidate.evidence.change.currency} · {candidate.evidence.change.observedFacts.description}</label>
              <select id={`match-${candidate.id}`} aria-label={`Match for ${candidate.evidence.change.observedFacts.description} ${candidate.evidence.change.postedDate}`} value={decisions[candidate.id] ?? ''}
                onChange={(event) => setDecisions((current) => ({ ...current, [candidate.id]: event.target.value }))}
                className="block w-full rounded-md border bg-background p-2">
                <option value="">Choose an action</option><option value="new">This is a new transaction</option>
                {candidate.evidence.candidates.map((match) => <option key={match.id} value={match.id}>Match: {match.posted.slice(0, 10)} · {match.amount} · {match.description}{match.searched ? ' (searched)' : ''}</option>)}
              </select>
              <MatchSearch connectionId={selected} batchId={review.batchId} candidateId={candidate.id} disabled={busy}
                label={`${candidate.evidence.change.observedFacts.description} ${candidate.evidence.change.postedDate}`} onSelect={(match) => {
                  setReview((current) => current ? { ...current, cases: current.cases.map((reviewCase) => ({ ...reviewCase,
                    candidates: reviewCase.candidates.map((entry) => entry.id === candidate.id ? { ...entry,
                      evidence: { ...entry.evidence, candidates: [...entry.evidence.candidates.filter((existing) => existing.id !== match.id), match] } } : entry),
                  })) } : current);
                  setDecisions((current) => ({ ...current, [candidate.id]: match.id }));
                }} />
            </div>)}
          </div>)}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => {
              const items = Object.entries(decisions).filter(([, value]) => value).map(([candidateId, value]) => value === 'new'
                ? { candidateId, action: 'NEW_TRANSACTION' as const }
                : { candidateId, action: 'SAME_TRANSACTION' as const, transactionId: value });
              const saved = await api.saveBankReviewDraft(selected, review.batchId, review.draftVersion, items);
              setReview((current) => current?.batchId === review.batchId ? { ...current, draftVersion: saved.data.draftVersion } : current);
            }, 'Draft saved.')}>Save draft</Button>
            <Button size="sm" disabled={busy || review.cases.some((item) => item.candidates.some((candidate) => !decisions[candidate.id]))} onClick={() => {
              const conflicts = review.cases.flatMap((item) => item.candidates).filter((candidate) => {
                const match = candidate.evidence.candidates.find((item) => item.id === decisions[candidate.id]);
                return match?.searched && match.posted.slice(0, 10) !== candidate.evidence.change.postedDate;
              }).length;
              if (!window.confirm(`Apply these matches and switch the mapped accounts to Plaid?${conflicts ? ` ${conflicts} searched match(es) have a different date and will use Plaid's date.` : ''}`)) return;
              const items = review.cases.flatMap((item) => item.candidates.map((candidate) => decisions[candidate.id] === 'new'
                ? { candidateId: candidate.id, action: 'NEW_TRANSACTION' as const }
                : { candidateId: candidate.id, action: 'SAME_TRANSACTION' as const, transactionId: decisions[candidate.id] }));
              void run(async () => { await api.commitBankReview(selected, review.batchId, items); setReview(null); }, 'Review approved. Import is queued.');
            }}>Approve and switch</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => {
              await api.refreshBankReview(selected, review.batchId); setReview(null);
            }, 'History refresh queued.')}>Refresh review</Button>
          </div>
        </div>}
      </CardContent>
    </Card>
  );
}
