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
import type { TransactionEntity } from '@actual-app/core/types/models';

import { Page } from '#components/Page';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { useTransactions } from '#hooks/useTransactions';
import * as queries from '#queries';

import {
  createPaymentChain,
  getPaymentChain,
  linkPaymentChainTransaction,
  listContracts,
  listPaymentChains,
  replacePaymentChainSplits,
  resolvePaymentChainClarification,
  suggestPaymentChainTransactions,
  unlinkPaymentChainTransaction,
  type Contract,
  type PaymentChain,
  type PaymentChainDetail,
  type PaymentRole,
  type SplitKind,
  type TransactionCandidate,
} from './api';

const ROLE_OPTIONS: Array<readonly [PaymentRole, string]> = [
  ['payment_attempt', 'Erster Einzug'],
  ['reversal', 'Rücklastschrift / Rückgabe'],
  ['settlement', 'Endgültige Zahlung'],
  ['fee', 'Gebühr'],
  ['failed', 'Fehlgeschlagener Versuch'],
];

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS) as Record<PaymentRole, string>;

const SPLIT_LABELS: Array<readonly [SplitKind, string]> = [
  ['contract_amount', 'Vertragsbetrag'],
  ['return_fee', 'Rücklastschriftgebühr'],
  ['bank_fee', 'Bankgebühr'],
  ['dunning_fee', 'Mahngebühr'],
  ['other_fee', 'Sonstige Gebühr'],
];

type SplitDraft = Record<SplitKind, string>;

const EMPTY_SPLIT: SplitDraft = {
  contract_amount: '',
  return_fee: '',
  bank_fee: '',
  dunning_fee: '',
  other_fee: '',
};

function formatAmount(amount: number | null | undefined, currency = 'EUR') {
  if (amount == null) return '–';
  return `${integerToCurrencyWithDecimal(Math.abs(amount), currency)} ${currency}`;
}

function transactionLabel(
  transaction: TransactionEntity | undefined,
  payeeName: string | undefined,
) {
  if (!transaction) return 'Buchung nicht im aktuellen Ausschnitt';
  return `${transaction.date} · ${payeeName || transaction.imported_payee || 'Ohne Zahlungsempfänger'} · ${formatAmount(transaction.amount)}`;
}

function splitDraft(detail: PaymentChainDetail): Record<string, SplitDraft> {
  const result: Record<string, SplitDraft> = {};
  for (const link of detail.links) {
    const current = { ...EMPTY_SPLIT };
    for (const split of link.splits) {
      current[split.kind] = integerToCurrencyWithDecimal(
        split.amountMinor,
        detail.chain.currency ?? 'EUR',
      );
    }
    result[link.id] = current;
  }
  return result;
}

export function PaymentChainsPage() {
  const navigate = useNavigate();
  const { data: payees = [] } = usePayees();
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
    options: { pageSize: 200 },
  });

  const payeesById = useMemo(
    () => new Map(payees.map(payee => [payee.id, payee])),
    [payees],
  );
  const transactionsById = useMemo(
    () => new Map(transactions.map(transaction => [transaction.id, transaction])),
    [transactions],
  );

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [chains, setChains] = useState<PaymentChain[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentChainDetail | null>(null);
  const [suggestions, setSuggestions] = useState<
    Awaited<ReturnType<typeof suggestPaymentChainTransactions>>['suggestions']
  >([]);
  const [caseRoles, setCaseRoles] = useState<Record<string, PaymentRole>>({});
  const [splits, setSplits] = useState<Record<string, SplitDraft>>({});
  const [contractId, setContractId] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const refreshLists = useCallback(async () => {
    const [contractItems, chainItems] = await Promise.all([
      listContracts(),
      listPaymentChains(),
    ]);
    setContracts(contractItems);
    setChains(chainItems);
    setSelectedId(current =>
      current && chainItems.some(item => item.id === current)
        ? current
        : chainItems[0]?.id ?? null,
    );
  }, []);

  useEffect(() => {
    void refreshLists().catch(error =>
      setMessage(error instanceof Error ? error.message : 'Fehler'),
    );
  }, [refreshLists]);

  const refreshDetail = useCallback(async (id: string) => {
    const value = await getPaymentChain(id);
    setDetail(value);
    setSplits(splitDraft(value));
    const roles: Record<string, PaymentRole> = {};
    for (const clarification of value.clarifications) {
      const suggested = clarification.payload.suggestedRole;
      if (
        typeof suggested === 'string' &&
        ROLE_OPTIONS.some(([role]) => role === suggested)
      ) {
        roles[clarification.id] = suggested as PaymentRole;
      }
    }
    setCaseRoles(roles);
    return value;
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void refreshDetail(selectedId).catch(error =>
      setMessage(error instanceof Error ? error.message : 'Fehler'),
    );
  }, [refreshDetail, selectedId]);

  const buildCandidates = useCallback((): TransactionCandidate[] => {
    return transactions
      .filter(transaction => !transaction.is_child && !transaction._deleted)
      .map(transaction => ({
        actualTransactionId: transaction.id,
        date: transaction.date,
        amountMinor: transaction.amount,
        accountId: transaction.account,
        payeeId: transaction.payee ?? null,
        payeeName: transaction.payee
          ? payeesById.get(transaction.payee)?.name ?? null
          : transaction.imported_payee ?? null,
        notes: transaction.notes ?? null,
      }));
  }, [payeesById, transactions]);

  const refreshSuggestions = useCallback(async () => {
    if (!selectedId || transactionsLoading) return;
    const result = await suggestPaymentChainTransactions(
      selectedId,
      buildCandidates(),
    );
    setSuggestions(result.suggestions);
    setDetail(result.detail);
    setSplits(splitDraft(result.detail));
  }, [buildCandidates, selectedId, transactionsLoading]);

  useEffect(() => {
    if (selectedId && !transactionsLoading) {
      void refreshSuggestions().catch(() => {
        // Ketten bleiben auch ohne automatische Vorschläge manuell nutzbar.
      });
    }
  }, [refreshSuggestions, selectedId, transactionsLoading]);

  const createChain = async () => {
    if (!contractId) {
      setMessage('Bitte zuerst einen Vertrag auswählen.');
      return;
    }

    const amount =
      expectedAmount.trim() === ''
        ? null
        : currencyToInteger(expectedAmount);
    if (expectedAmount.trim() !== '' && amount == null) {
      setMessage('Ungültiger Betrag.');
      return;
    }

    try {
      const chain = await createPaymentChain({
        contractId,
        title: title || null,
        dueDate: dueDate || null,
        expectedAmountMinor: amount,
      });
      setTitle('');
      setDueDate('');
      setExpectedAmount('');
      await refreshLists();
      setSelectedId(chain.id);
      setMessage('Zahlungskette angelegt.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    }
  };

  const confirmSuggestion = async (
    transactionId: string,
    role: PaymentRole,
    confidence: number,
  ) => {
    if (!selectedId) return;
    const transaction = transactionsById.get(transactionId);
    if (!transaction) return;

    const next = await linkPaymentChainTransaction(selectedId, {
      actualTransactionId: transaction.id,
      role,
      amountMinor: transaction.amount,
      date: transaction.date,
      confidence,
    });
    setDetail(next);
    setSplits(splitDraft(next));
    await refreshLists();
    await refreshSuggestions();
  };

  const resolveCase = async (
    caseId: string,
    action: 'confirm' | 'dismiss',
    transactionId: string | null,
  ) => {
    if (!selectedId) return;
    if (action === 'dismiss') {
      const next = await resolvePaymentChainClarification(
        selectedId,
        caseId,
        { action: 'dismiss' },
      );
      setDetail(next);
      await refreshLists();
      return;
    }

    if (!transactionId) return;
    const transaction = transactionsById.get(transactionId);
    if (!transaction) return;
    const next = await resolvePaymentChainClarification(selectedId, caseId, {
      action: 'confirm',
      role: caseRoles[caseId] ?? 'settlement',
      amountMinor: transaction.amount,
      date: transaction.date,
    });
    setDetail(next);
    setSplits(splitDraft(next));
    await refreshLists();
    await refreshSuggestions();
  };

  const saveSplits = async (linkId: string) => {
    if (!selectedId) return;
    const draft = splits[linkId] ?? EMPTY_SPLIT;
    const values = SPLIT_LABELS.flatMap(([kind]) => {
      const raw = draft[kind].trim();
      if (!raw) return [];
      const amount = currencyToInteger(raw);
      if (amount == null) throw new Error('Ungültiger Split-Betrag');
      return [{ kind, amountMinor: Math.abs(amount) }];
    });

    try {
      const next = await replacePaymentChainSplits(selectedId, linkId, values);
      setDetail(next);
      setSplits(splitDraft(next));
      setMessage('Aufteilung gespeichert.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    }
  };

  const contractOptions: Array<readonly [string, string]> = [
    ['', 'Vertrag auswählen'],
    ...contracts.map(contract => [
      contract.id,
      contract.provider ? `${contract.provider} · ${contract.title}` : contract.title,
    ] as const),
  ];

  return (
    <Page header="ActualForge · Zahlungsketten">
      <View style={{ maxWidth: 1220, paddingBottom: 30, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="normal" onPress={() => void navigate('/actualforge')}>
            ← Übersicht
          </Button>
          <Button variant="normal" onPress={() => void navigate('/actualforge/contracts')}>
            Verträge
          </Button>
        </View>

        {message && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 10 }}>
              <Text>{message}</Text>
            </View>
          </Card>
        )}

        <Card style={{ margin: 0 }}>
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>
              Neue Zahlungskette
            </Text>
            <Text style={{ opacity: 0.7 }}>
              Eine Kette bündelt Einzug, Rücklastschrift, erneuten Einzug und Gebühren,
              ohne die Actual-Buchungen zu verändern.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Select
                value={contractId}
                options={contractOptions}
                onChange={value => {
                  setContractId(value);
                  const contract = contracts.find(item => item.id === value);
                  setDueDate(contract?.nextPaymentDate ?? '');
                  setExpectedAmount(
                    contract?.amountMinor == null
                      ? ''
                      : integerToCurrencyWithDecimal(
                          contract.amountMinor,
                          contract.currency ?? 'EUR',
                        ),
                  );
                }}
                style={{ minWidth: 260 }}
              />
              <Input
                value={title}
                placeholder="Bezeichnung (optional)"
                onChangeValue={setTitle}
              />
              <Input type="date" value={dueDate} onChangeValue={setDueDate} />
              <Input
                value={expectedAmount}
                placeholder="Erwarteter Betrag"
                onChangeValue={setExpectedAmount}
              />
              <Button variant="primary" onPress={() => void createChain()}>
                + Kette anlegen
              </Button>
            </View>
          </View>
        </Card>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <Card style={{ margin: 0, flex: '1 1 300px', minWidth: 270 }}>
            <View style={{ padding: 12, gap: 7 }}>
              <Text style={{ fontSize: 16, fontWeight: 600 }}>
                Zahlungsketten ({chains.length})
              </Text>
              {chains.length === 0 && (
                <Text style={{ opacity: 0.7 }}>Noch keine Ketten vorhanden.</Text>
              )}
              {chains.map(chain => (
                <Button
                  key={chain.id}
                  variant={selectedId === chain.id ? 'menuSelected' : 'menu'}
                  onPress={() => setSelectedId(chain.id)}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  <View style={{ alignItems: 'flex-start', gap: 2 }}>
                    <Text style={{ fontWeight: 600 }}>
                      {chain.title || chain.contractTitle || 'Zahlungskette'}
                    </Text>
                    <Text style={{ opacity: 0.7 }}>
                      {chain.dueDate ?? 'ohne Fälligkeit'} ·{' '}
                      {formatAmount(chain.expectedAmountMinor, chain.currency ?? 'EUR')}
                    </Text>
                    <Text style={{ opacity: 0.65 }}>
                      {chain.status}
                      {chain.openClarificationCount
                        ? ` · ${chain.openClarificationCount} Klärfall/Klärfälle`
                        : ''}
                    </Text>
                  </View>
                </Button>
              ))}
            </View>
          </Card>

          <View style={{ flex: '3 1 680px', minWidth: 0, gap: 14 }}>
            {detail && (
              <>
                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <Text style={{ fontSize: 17, fontWeight: 600 }}>
                      {detail.chain.title ||
                        detail.chain.contractTitle ||
                        'Zahlungskette'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      <Text>
                        Status: <strong>{detail.chain.status}</strong>
                      </Text>
                      <Text>
                        Final gezahlt:{' '}
                        <strong>
                          {formatAmount(
                            detail.summary.finalPaymentMinor,
                            detail.chain.currency ?? 'EUR',
                          )}
                        </strong>
                      </Text>
                      <Text>
                        Gebühren:{' '}
                        <strong>
                          {formatAmount(
                            detail.summary.feeTotalMinor,
                            detail.chain.currency ?? 'EUR',
                          )}
                        </strong>
                      </Text>
                      <Text>
                        Wirtschaftlich:{' '}
                        <strong>
                          {formatAmount(
                            detail.summary.economicTotalMinor,
                            detail.chain.currency ?? 'EUR',
                          )}
                        </strong>
                      </Text>
                    </View>
                    <Text style={{ opacity: 0.7 }}>
                      Frühere Einzüge und Rücklastschriften bleiben Teil der Historie.
                      Als Vertragszahlung zählt nur die endgültige Zahlung.
                    </Text>
                  </View>
                </Card>

                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 9 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <View>
                        <Text style={{ fontSize: 16, fontWeight: 600 }}>
                          Automatische Vorschläge
                        </Text>
                        <Text style={{ opacity: 0.7 }}>
                          Hohe Sicherheit wird vorgeschlagen, aber nie automatisch verknüpft.
                        </Text>
                      </View>
                      <Button variant="normal" onPress={() => void refreshSuggestions()}>
                        Neu prüfen
                      </Button>
                    </View>
                    {suggestions
                      .filter(item => !item.clarificationCaseId)
                      .map(item => {
                        const transaction = transactionsById.get(
                          item.actualTransactionId,
                        );
                        const payee = transaction?.payee
                          ? payeesById.get(transaction.payee)?.name
                          : undefined;
                        return (
                          <View
                            key={item.actualTransactionId}
                            style={{
                              borderTop: `1px solid ${theme.tableBorder}`,
                              paddingTop: 8,
                              gap: 5,
                            }}
                          >
                            <Text>{transactionLabel(transaction, payee)}</Text>
                            <Text style={{ opacity: 0.7 }}>
                              {ROLE_LABELS[item.role]} ·{' '}
                              {Math.round(item.score * 100)} % ·{' '}
                              {item.reasons.join(', ')}
                            </Text>
                            <View style={{ alignItems: 'flex-start' }}>
                              <Button
                                variant="primary"
                                onPress={() =>
                                  void confirmSuggestion(
                                    item.actualTransactionId,
                                    item.role,
                                    item.score,
                                  )
                                }
                              >
                                Zuordnen
                              </Button>
                            </View>
                          </View>
                        );
                      })}
                  </View>
                </Card>

                {detail.clarifications.some(item => item.status === 'open') && (
                  <Card style={{ margin: 0 }}>
                    <View style={{ padding: 14, gap: 9 }}>
                      <Text style={{ fontSize: 16, fontWeight: 600 }}>
                        Klärfälle
                      </Text>
                      <Text style={{ opacity: 0.7 }}>
                        Unsichere Treffer werden nicht still übernommen. Rolle anpassen,
                        bestätigen oder bewusst nicht verknüpfen.
                      </Text>
                      {detail.clarifications
                        .filter(item => item.status === 'open')
                        .map(item => {
                          const transaction = item.actualTransactionId
                            ? transactionsById.get(item.actualTransactionId)
                            : undefined;
                          const payee = transaction?.payee
                            ? payeesById.get(transaction.payee)?.name
                            : undefined;
                          return (
                            <View
                              key={item.id}
                              style={{
                                borderTop: `1px solid ${theme.tableBorder}`,
                                paddingTop: 8,
                                gap: 6,
                              }}
                            >
                              <Text>
                                {transactionLabel(transaction, payee)} ·{' '}
                                {Math.round((item.confidence ?? 0) * 100)} %
                              </Text>
                              <View
                                style={{
                                  flexDirection: 'row',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                }}
                              >
                                <Select
                                  value={caseRoles[item.id] ?? 'settlement'}
                                  options={ROLE_OPTIONS}
                                  onChange={value =>
                                    setCaseRoles(current => ({
                                      ...current,
                                      [item.id]: value,
                                    }))
                                  }
                                />
                                <Button
                                  variant="primary"
                                  onPress={() =>
                                    void resolveCase(
                                      item.id,
                                      'confirm',
                                      item.actualTransactionId,
                                    )
                                  }
                                >
                                  Bestätigen / bearbeiten
                                </Button>
                                <Button
                                  variant="normal"
                                  onPress={() =>
                                    void resolveCase(
                                      item.id,
                                      'dismiss',
                                      item.actualTransactionId,
                                    )
                                  }
                                >
                                  Nicht verknüpfen
                                </Button>
                              </View>
                            </View>
                          );
                        })}
                    </View>
                  </Card>
                )}

                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 9 }}>
                    <Text style={{ fontSize: 16, fontWeight: 600 }}>
                      Verknüpfte Buchungen & Aufteilung
                    </Text>
                    {detail.links.length === 0 && (
                      <Text style={{ opacity: 0.7 }}>
                        Noch keine Buchung verknüpft.
                      </Text>
                    )}
                    {detail.links.map(link => {
                      const transaction = transactionsById.get(
                        link.actualTransactionId,
                      );
                      const payee = transaction?.payee
                        ? payeesById.get(transaction.payee)?.name
                        : undefined;
                      const draft = splits[link.id] ?? EMPTY_SPLIT;
                      return (
                        <View
                          key={link.id}
                          style={{
                            borderTop: `1px solid ${theme.tableBorder}`,
                            paddingTop: 9,
                            gap: 7,
                          }}
                        >
                          <Text style={{ fontWeight: 600 }}>
                            {ROLE_LABELS[link.role] ?? link.role}
                          </Text>
                          <Text>{transactionLabel(transaction, payee)}</Text>
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 7,
                            }}
                          >
                            {SPLIT_LABELS.map(([kind, label]) => (
                              <View key={kind} style={{ flex: '1 1 150px', gap: 3 }}>
                                <Text style={{ fontSize: 12, opacity: 0.7 }}>
                                  {label}
                                </Text>
                                <Input
                                  value={draft[kind]}
                                  placeholder="0,00"
                                  onChangeValue={value =>
                                    setSplits(current => ({
                                      ...current,
                                      [link.id]: {
                                        ...(current[link.id] ?? EMPTY_SPLIT),
                                        [kind]: value,
                                      },
                                    }))
                                  }
                                />
                              </View>
                            ))}
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Button
                              variant="normal"
                              onPress={() => void saveSplits(link.id)}
                            >
                              Aufteilung speichern
                            </Button>
                            <Button
                              variant="normal"
                              onPress={() => {
                                if (!selectedId) return;
                                void unlinkPaymentChainTransaction(
                                  selectedId,
                                  link.id,
                                ).then(next => {
                                  setDetail(next);
                                  setSplits(splitDraft(next));
                                  void refreshLists();
                                });
                              }}
                            >
                              Verknüpfung lösen
                            </Button>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </Card>
              </>
            )}
          </View>
        </View>
      </View>
    </Page>
  );
}
