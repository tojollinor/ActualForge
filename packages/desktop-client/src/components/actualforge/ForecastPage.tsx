import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@actual-app/components/button';
import { Card } from '@actual-app/components/card';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  currencyToInteger,
  integerToCurrencyWithDecimal,
} from '@actual-app/core/shared/util';

import { Page } from '#components/Page';
import { useAccountBalances } from '#hooks/useAccountBalances';
import { useAccounts } from '#hooks/useAccounts';
import { useBalanceForecast } from '#hooks/useBalanceForecast';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { useTransactions } from '#hooks/useTransactions';
import * as queries from '#queries';

import {
  createPrediction,
  generateActualForgeForecast,
  listClarifications,
  listPredictions,
  removePrediction,
  resolveClarification,
  type ClarificationCase,
  type ForecastResult,
  type PaymentRole,
  type PredictionEntry,
  type ScheduleForecastInput,
  type TransferCandidate,
  type TransferMatchKind,
} from './api';

const ROLE_OPTIONS: Array<readonly [PaymentRole, string]> = [
  ['payment_attempt', 'Zahlungsversuch'],
  ['reversal', 'Rückbuchung'],
  ['settlement', 'Endgültige Zahlung'],
  ['fee', 'Gebühr'],
  ['failed', 'Fehlgeschlagen'],
];

const TRANSFER_KIND_OPTIONS: Array<readonly [TransferMatchKind, string]> = [
  ['internal_transfer', 'Interne Umbuchung'],
  ['credit_card_payment', 'Kreditkartenzahlung'],
];

const SOURCE_LABELS: Record<string, string> = {
  actual_schedule: 'Actual-Schedule',
  contract: 'Vertrag',
  payment_chain: 'Zahlungskette',
  credit_card_settlement: 'Kreditkartenabrechnung',
  manual: 'Manuell',
};

type CaseDraft = {
  role?: PaymentRole;
  transferKind?: TransferMatchKind;
  amount?: string;
  date?: string;
};

function localToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1 + months, 1);
  const maxDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(day, maxDay));
  return [
    result.getFullYear(),
    String(result.getMonth() + 1).padStart(2, '0'),
    String(result.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatAmount(amount: number | null | undefined, currency = 'EUR') {
  if (amount == null) return '–';
  const prefix = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${prefix}${integerToCurrencyWithDecimal(Math.abs(amount), currency)} ${currency}`;
}

function numberFromPayload(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  return typeof payload[key] === 'number' ? payload[key] : null;
}

function stringFromPayload(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  return typeof payload[key] === 'string' ? payload[key] : null;
}

function ClarificationEditor({
  item,
  draft,
  onChange,
}: {
  item: ClarificationCase;
  draft: CaseDraft;
  onChange: (changes: Partial<CaseDraft>) => void;
}) {
  if (item.kind === 'payment-chain-link') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Select
          value={
            draft.role ??
            ((stringFromPayload(item.payload, 'suggestedRole') ??
              'settlement') as PaymentRole)
          }
          options={ROLE_OPTIONS}
          onChange={value => onChange({ role: value })}
          style={{ minWidth: 180 }}
        />
        <Input
          value={
            draft.amount ??
            String(numberFromPayload(item.payload, 'amountMinor') ?? '')
          }
          placeholder="Betrag in Cent"
          onChangeValue={value => onChange({ amount: value })}
        />
        <Input
          value={
            draft.date ??
            stringFromPayload(item.payload, 'date') ??
            ''
          }
          placeholder="YYYY-MM-DD"
          onChangeValue={value => onChange({ date: value })}
        />
      </View>
    );
  }

  if (item.kind === 'transfer-match') {
    return (
      <Select
        value={
          draft.transferKind ??
          ((stringFromPayload(item.payload, 'suggestedKind') ??
            'internal_transfer') as TransferMatchKind)
        }
        options={TRANSFER_KIND_OPTIONS}
        onChange={value => onChange({ transferKind: value })}
        style={{ minWidth: 220 }}
      />
    );
  }

  if (item.kind === 'contract-amount-change') {
    const suggested = numberFromPayload(item.payload, 'suggestedAmountMinor');
    return (
      <Input
        value={draft.amount ?? String(suggested ?? '')}
        placeholder="Neuer Betrag in Cent"
        onChangeValue={value => onChange({ amount: value })}
      />
    );
  }

  return (
    <Text style={{ opacity: 0.7 }}>
      Für diesen Klärfall stehen keine bearbeitbaren Felder zur Verfügung.
    </Text>
  );
}

export function ForecastPage() {
  const navigate = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();

  const activeAccounts = useMemo(
    () => accounts.filter(account => !account.closed && !account.tombstone),
    [accounts],
  );
  const accountIds = useMemo(
    () => activeAccounts.map(account => account.id),
    [activeAccounts],
  );
  const balances = useAccountBalances(accountIds);

  const [horizonMonths, setHorizonMonths] = useState('3');
  const startDate = useMemo(() => localToday(), []);
  const endDate = useMemo(
    () => addMonths(startDate, Number.parseInt(horizonMonths, 10)),
    [horizonMonths, startDate],
  );

  const actualForecast = useBalanceForecast({
    accountIds,
    startDate,
    endDate,
    source: 'schedules',
    enabled: accountIds.length > 0,
  });

  const transactionsQuery = useMemo(
    () =>
      queries
        .transactions()
        .options({ splits: 'all' })
        .select('*')
        .orderBy({ date: 'desc' }),
    [],
  );
  const { transactions, isPending: transactionsLoading } = useTransactions({
    query: transactionsQuery,
    options: { pageSize: 600 },
  });

  const accountsById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts],
  );
  const payeesById = useMemo(
    () => new Map(payees.map(payee => [payee.id, payee])),
    [payees],
  );

  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
  const [clarifications, setClarifications] = useState<ClarificationCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [manualTitle, setManualTitle] = useState('');
  const [manualAccountId, setManualAccountId] = useState('');
  const [manualDate, setManualDate] = useState(startDate);
  const [manualAmount, setManualAmount] = useState('');
  const [manualNotes, setManualNotes] = useState('');

  const [editingCases, setEditingCases] = useState<Set<string>>(
    () => new Set(),
  );
  const [caseDrafts, setCaseDrafts] = useState<Record<string, CaseDraft>>({});

  const buildScheduleEvents = useCallback((): ScheduleForecastInput[] => {
    const dataPoints = actualForecast.data?.dataPoints ?? [];
    return dataPoints.flatMap(point =>
      point.transactions.map((transaction, index) => ({
        sourceRef: `${transaction.scheduleId}:${point.date}:${point.accountId}:${index}`,
        accountId: point.accountId,
        accountName: point.accountName,
        title:
          transaction.scheduleName ||
          transaction.payee ||
          'Geplante Actual-Buchung',
        date: point.date,
        amountMinor: transaction.amount,
        confidence: 1,
      })),
    );
  }, [actualForecast.data]);

  const buildTransactionCandidates = useCallback((): TransferCandidate[] => {
    return transactions
      .filter(transaction => !transaction.is_child && !transaction._deleted)
      .map(transaction => {
        const payee = transaction.payee
          ? payeesById.get(transaction.payee)
          : undefined;
        return {
          actualTransactionId: transaction.id,
          date: transaction.date,
          amountMinor: transaction.amount,
          accountId: transaction.account,
          accountName: accountsById.get(transaction.account)?.name ?? null,
          payeeId: transaction.payee ?? null,
          payeeName: payee?.name ?? transaction.imported_payee ?? null,
          notes: transaction.notes ?? null,
          transferId: transaction.transfer_id ?? null,
          transferAccountId: payee?.transfer_acct ?? null,
        };
      });
  }, [accountsById, payeesById, transactions]);

  const refreshLists = useCallback(async () => {
    const [predictionList, caseList] = await Promise.all([
      listPredictions(),
      listClarifications('open'),
    ]);
    setPredictions(predictionList);
    setClarifications(caseList);
  }, []);

  const calculateForecast = useCallback(async () => {
    if (actualForecast.isPending || transactionsLoading) return;

    const accountInputs = activeAccounts
      .filter(account => balances[account.id] != null)
      .map(account => ({
        accountId: account.id,
        accountName: account.name,
        balanceMinor: balances[account.id] ?? 0,
      }));

    if (accountInputs.length === 0) {
      setMessage('Kontostände sind noch nicht verfügbar.');
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const result = await generateActualForgeForecast({
        startDate,
        endDate,
        accounts: accountInputs,
        scheduleEvents: buildScheduleEvents(),
        transactionCandidates: buildTransactionCandidates(),
      });
      setForecast(result);
      await refreshLists();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  }, [
    activeAccounts,
    actualForecast.isPending,
    balances,
    buildScheduleEvents,
    buildTransactionCandidates,
    endDate,
    refreshLists,
    startDate,
    transactionsLoading,
  ]);

  useEffect(() => {
    void refreshLists().catch(error =>
      setMessage(error instanceof Error ? error.message : 'Fehler'),
    );
  }, [refreshLists]);

  useEffect(() => {
    if (
      !actualForecast.isPending &&
      !transactionsLoading &&
      accountIds.length > 0 &&
      accountIds.every(id => balances[id] != null)
    ) {
      void calculateForecast();
    }
  }, [
    accountIds,
    actualForecast.isPending,
    balances,
    calculateForecast,
    transactionsLoading,
  ]);

  const addManualPrediction = async () => {
    const amountMinor = currencyToInteger(manualAmount);
    if (
      !manualTitle.trim() ||
      !manualAccountId ||
      !manualDate ||
      amountMinor == null ||
      amountMinor === 0
    ) {
      setMessage(
        'Bitte Titel, Konto, Datum und einen Betrag ungleich 0 angeben.',
      );
      return;
    }

    try {
      await createPrediction({
        title: manualTitle.trim(),
        accountId: manualAccountId,
        expectedDate: manualDate,
        amountMinor,
        currency: 'EUR',
        notes: manualNotes || null,
      });
      setManualTitle('');
      setManualAmount('');
      setManualNotes('');
      await refreshLists();
      await calculateForecast();
      setMessage('Geplante Zahlung gespeichert.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    }
  };

  const removeManualPrediction = async (id: string) => {
    await removePrediction(id);
    await refreshLists();
    await calculateForecast();
  };

  const setCaseDraft = (id: string, changes: Partial<CaseDraft>) => {
    setCaseDrafts(current => ({
      ...current,
      [id]: { ...current[id], ...changes },
    }));
  };

  const confirmCase = async (item: ClarificationCase) => {
    const draft = caseDrafts[item.id] ?? {};
    const payload = item.payload;

    if (item.kind === 'payment-chain-link') {
      const amount =
        draft.amount != null
          ? Number.parseInt(draft.amount, 10)
          : numberFromPayload(payload, 'amountMinor');
      const date =
        draft.date ?? stringFromPayload(payload, 'date') ?? undefined;
      const role =
        draft.role ??
        ((stringFromPayload(payload, 'suggestedRole') ??
          'settlement') as PaymentRole);

      if (amount == null || !Number.isInteger(amount) || !date) {
        setMessage('Klärfall enthält keinen gültigen Betrag oder kein Datum.');
        return;
      }

      const result = await resolveClarification(item.id, {
        action: 'confirm',
        role,
        amountMinor: amount,
        date,
      });
      setClarifications(result.filter(candidate => candidate.status === 'open'));
    } else if (item.kind === 'transfer-match') {
      const result = await resolveClarification(item.id, {
        action: 'confirm',
        transferKind:
          draft.transferKind ??
          ((stringFromPayload(payload, 'suggestedKind') ??
            'internal_transfer') as TransferMatchKind),
      });
      setClarifications(result.filter(candidate => candidate.status === 'open'));
    } else if (item.kind === 'contract-amount-change') {
      const amount =
        draft.amount != null
          ? Number.parseInt(draft.amount, 10)
          : numberFromPayload(payload, 'suggestedAmountMinor');
      if (amount == null || !Number.isInteger(amount) || amount <= 0) {
        setMessage('Bitte einen gültigen neuen Vertragsbetrag angeben.');
        return;
      }
      const result = await resolveClarification(item.id, {
        action: 'confirm',
        amountMinor: amount,
      });
      setClarifications(result.filter(candidate => candidate.status === 'open'));
    } else {
      setMessage('Dieser Klärfall kann nur verworfen werden.');
      return;
    }

    setEditingCases(current => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    await calculateForecast();
  };

  const dismissCase = async (id: string) => {
    const result = await resolveClarification(id, { action: 'dismiss' });
    setClarifications(result.filter(candidate => candidate.status === 'open'));
  };

  const manualPredictions = predictions.filter(
    prediction => prediction.sourceKind === 'manual',
  );

  const accountOptions: Array<readonly [string, string]> = [
    ['', 'Konto auswählen'],
    ...activeAccounts.map(account => [account.id, account.name] as const),
  ];

  return (
    <Page header="ActualForge · Prognose & Klärfälle">
      <View style={{ maxWidth: 1260, paddingBottom: 30, gap: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="normal" onPress={() => void navigate('/actualforge')}>
            ← Übersicht
          </Button>
          <Button
            variant="normal"
            onPress={() => void navigate('/actualforge/transfers')}
          >
            Umbuchungen & Kreditkarten
          </Button>
          <Select
            value={horizonMonths}
            options={[
              ['1', '1 Monat'],
              ['3', '3 Monate'],
              ['6', '6 Monate'],
              ['12', '12 Monate'],
            ]}
            onChange={setHorizonMonths}
          />
          <Button
            variant="primary"
            isDisabled={loading || actualForecast.isPending}
            onPress={() => void calculateForecast()}
          >
            {loading ? 'Berechne…' : 'Prognose aktualisieren'}
          </Button>
        </View>

        {message && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 10 }}>
              <Text>{message}</Text>
            </View>
          </Card>
        )}

        {forecast && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Card style={{ flex: '1 1 210px', margin: 0 }}>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text style={{ opacity: 0.7 }}>Aktuell</Text>
                  <Text style={{ fontSize: 19, fontWeight: 600 }}>
                    {formatAmount(forecast.summary.totalStartBalanceMinor)}
                  </Text>
                </View>
              </Card>
              <Card style={{ flex: '1 1 210px', margin: 0 }}>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text style={{ opacity: 0.7 }}>Prognose {forecast.endDate}</Text>
                  <Text style={{ fontSize: 19, fontWeight: 600 }}>
                    {formatAmount(forecast.summary.totalEndBalanceMinor)}
                  </Text>
                </View>
              </Card>
              <Card style={{ flex: '1 1 210px', margin: 0 }}>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text style={{ opacity: 0.7 }}>Erwartete Einnahmen</Text>
                  <Text style={{ fontSize: 19, fontWeight: 600 }}>
                    {formatAmount(forecast.summary.incomeMinor)}
                  </Text>
                </View>
              </Card>
              <Card style={{ flex: '1 1 210px', margin: 0 }}>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text style={{ opacity: 0.7 }}>Erwartete Ausgaben</Text>
                  <Text style={{ fontSize: 19, fontWeight: 600 }}>
                    {formatAmount(-forecast.summary.expenseMinor)}
                  </Text>
                </View>
              </Card>
            </View>

            <Card style={{ margin: 0 }}>
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: 600 }}>
                  Kontenentwicklung
                </Text>
                {forecast.accounts.map(account => (
                  <View
                    key={account.accountId}
                    style={{
                      borderTop: `1px solid ${theme.tableBorder}`,
                      paddingTop: 8,
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <Text style={{ fontWeight: 600, minWidth: 160 }}>
                      {account.accountName ?? account.accountId}
                    </Text>
                    <Text>
                      Heute: {formatAmount(account.startBalanceMinor)}
                    </Text>
                    <Text>
                      Ende: {formatAmount(account.endBalanceMinor)}
                    </Text>
                    <Text>
                      Tiefpunkt: {formatAmount(account.lowestBalanceMinor)} am{' '}
                      {account.lowestBalanceDate}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card style={{ margin: 0 }}>
              <View style={{ padding: 14, gap: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: 600 }}>
                  Erwartete Bewegungen ({forecast.entries.length})
                </Text>
                {forecast.entries.length === 0 && (
                  <Text style={{ opacity: 0.7 }}>
                    Im gewählten Zeitraum wurden keine geplanten Bewegungen
                    gefunden.
                  </Text>
                )}
                {forecast.entries.map(entry => (
                  <View
                    key={entry.id}
                    style={{
                      borderTop: `1px solid ${theme.tableBorder}`,
                      paddingTop: 8,
                      gap: 3,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <Text style={{ fontWeight: 600 }}>
                        {entry.date} · {entry.title}
                      </Text>
                      <Text style={{ fontWeight: 600 }}>
                        {formatAmount(entry.amountMinor, entry.currency)}
                      </Text>
                    </View>
                    <Text style={{ opacity: 0.7 }}>
                      {entry.accountName ?? entry.accountId} ·{' '}
                      {SOURCE_LABELS[entry.sourceKind] ?? entry.sourceKind} ·{' '}
                      {Math.round(entry.confidence * 100)} % ·{' '}
                      {entry.explanation}
                    </Text>
                    {entry.projectedBalanceMinor != null && (
                      <Text style={{ opacity: 0.7 }}>
                        Kontostand danach:{' '}
                        {formatAmount(entry.projectedBalanceMinor)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </Card>
          </>
        )}

        <Card style={{ margin: 0 }}>
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>
              Bekannte zukünftige Zahlungen
            </Text>
            <Text style={{ opacity: 0.7 }}>
              Positive Beträge sind Einnahmen, negative Beträge Ausgaben.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Input
                value={manualTitle}
                placeholder="Bezeichnung"
                onChangeValue={setManualTitle}
              />
              <Select
                value={manualAccountId}
                options={accountOptions}
                onChange={setManualAccountId}
                style={{ minWidth: 220 }}
              />
              <Input
                value={manualDate}
                placeholder="YYYY-MM-DD"
                onChangeValue={setManualDate}
              />
              <Input
                value={manualAmount}
                placeholder="-49,99 oder 2500,00"
                onChangeValue={setManualAmount}
              />
              <Input
                value={manualNotes}
                placeholder="Notiz"
                onChangeValue={setManualNotes}
              />
              <Button
                variant="primary"
                onPress={() => void addManualPrediction()}
              >
                Einplanen
              </Button>
            </View>

            {manualPredictions.map(prediction => (
              <View
                key={prediction.id}
                style={{
                  borderTop: `1px solid ${theme.tableBorder}`,
                  paddingTop: 8,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Text style={{ fontWeight: 600 }}>
                    {prediction.expectedDate} · {prediction.title}
                  </Text>
                  <Text style={{ opacity: 0.7 }}>
                    {prediction.accountId
                      ? accountsById.get(prediction.accountId)?.name ??
                        prediction.accountId
                      : 'Kein Konto'}{' '}
                    · {formatAmount(prediction.amountMinor, prediction.currency)}
                  </Text>
                </View>
                <Button
                  variant="normal"
                  onPress={() => void removeManualPrediction(prediction.id)}
                >
                  Entfernen
                </Button>
              </View>
            ))}
          </View>
        </Card>

        <Card style={{ margin: 0 }}>
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>
              Klärfälle ({clarifications.length})
            </Text>
            <Text style={{ opacity: 0.7 }}>
              Unsichere Zuordnungen und erkannte dauerhafte Preisänderungen
              werden hier gesammelt. Keine davon verändert Actual automatisch.
            </Text>

            {clarifications.length === 0 && (
              <Text style={{ opacity: 0.7 }}>Keine offenen Klärfälle.</Text>
            )}

            {clarifications.map(item => {
              const editing = editingCases.has(item.id);
              const suggestedAmount =
                numberFromPayload(item.payload, 'suggestedAmountMinor') ??
                numberFromPayload(item.payload, 'amountMinor');
              const contractTitle = stringFromPayload(
                item.payload,
                'contractTitle',
              );
              const reasons = Array.isArray(item.payload.reasons)
                ? item.payload.reasons.map(String).join(', ')
                : null;

              return (
                <View
                  key={item.id}
                  style={{
                    borderTop: `1px solid ${theme.tableBorder}`,
                    paddingTop: 9,
                    gap: 6,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontWeight: 600 }}>
                      {item.subject ?? item.kind}
                      {contractTitle ? ` · ${contractTitle}` : ''}
                    </Text>
                    <Text style={{ opacity: 0.7 }}>
                      {item.confidence == null
                        ? 'Confidence unbekannt'
                        : `${Math.round(item.confidence * 100)} %`}
                    </Text>
                  </View>

                  {suggestedAmount != null && (
                    <Text>
                      Vorgeschlagener Betrag: {formatAmount(-Math.abs(suggestedAmount))}
                    </Text>
                  )}
                  {reasons && (
                    <Text style={{ opacity: 0.7 }}>Hinweise: {reasons}</Text>
                  )}
                  {item.actualTransactionId && (
                    <Text style={{ opacity: 0.7 }}>
                      Actual-Buchung: {item.actualTransactionId}
                    </Text>
                  )}

                  {editing && (
                    <ClarificationEditor
                      item={item}
                      draft={caseDrafts[item.id] ?? {}}
                      onChange={changes => setCaseDraft(item.id, changes)}
                    />
                  )}

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button
                      variant="primary"
                      onPress={() => void confirmCase(item)}
                    >
                      Bestätigen
                    </Button>
                    <Button
                      variant="normal"
                      onPress={() =>
                        setEditingCases(current => {
                          const next = new Set(current);
                          if (next.has(item.id)) {
                            next.delete(item.id);
                          } else {
                            next.add(item.id);
                          }
                          return next;
                        })
                      }
                    >
                      {editing ? 'Bearbeitung schließen' : 'Bearbeiten'}
                    </Button>
                    <Button
                      variant="normal"
                      onPress={() => void dismissCase(item.id)}
                    >
                      Nicht verknüpfen
                    </Button>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      </View>
    </Page>
  );
}
