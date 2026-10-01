import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@actual-app/components/button';
import { Card } from '@actual-app/components/card';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { integerToCurrencyWithDecimal } from '@actual-app/core/shared/util';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { Page } from '#components/Page';
import { useAccounts } from '#hooks/useAccounts';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { useTransactions } from '#hooks/useTransactions';
import * as queries from '#queries';

import {
  analyzeCreditCards,
  confirmTransferSuggestion,
  listCreditCards,
  removeCreditCard,
  removeTransfer,
  resolveTransferCase,
  suggestTransfers,
  upsertCreditCard,
  type CreditCardAnalysis,
  type CreditCardProfile,
  type TransferCandidate,
  type TransferClarification,
  type TransferMatch,
  type TransferMatchKind,
  type TransferSuggestion,
} from './api';

const KIND_LABELS: Record<TransferMatchKind, string> = {
  internal_transfer: 'Interne Umbuchung',
  credit_card_payment: 'Kreditkartenzahlung',
};

function formatAmount(amount: number | null | undefined) {
  if (amount == null) return '–';
  return `${integerToCurrencyWithDecimal(Math.abs(amount), 'EUR')} EUR`;
}

function transactionLabel(
  transaction: TransactionEntity | undefined,
  accountName: string,
  payeeName: string | undefined,
) {
  if (!transaction) return 'Buchung nicht im aktuellen Ausschnitt';
  return `${transaction.date} · ${accountName} · ${payeeName || transaction.imported_payee || 'Ohne Zahlungsempfänger'} · ${formatAmount(transaction.amount)}`;
}

export function TransfersPage() {
  const navigate = useNavigate();
  const { data: accounts = [] } = useAccounts();
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
    options: { pageSize: 300 },
  });

  const accountsById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts],
  );
  const payeesById = useMemo(
    () => new Map(payees.map(payee => [payee.id, payee])),
    [payees],
  );
  const transactionsById = useMemo(
    () => new Map(transactions.map(transaction => [transaction.id, transaction])),
    [transactions],
  );

  const [matches, setMatches] = useState<TransferMatch[]>([]);
  const [suggestions, setSuggestions] = useState<TransferSuggestion[]>([]);
  const [clarifications, setClarifications] = useState<TransferClarification[]>([]);
  const [cards, setCards] = useState<CreditCardProfile[]>([]);
  const [cardAnalysis, setCardAnalysis] = useState<CreditCardAnalysis[]>([]);
  const [cardAccountId, setCardAccountId] = useState('');
  const [fundingAccountId, setFundingAccountId] = useState('');
  const [cardLabel, setCardLabel] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const buildCandidates = useCallback((): TransferCandidate[] => {
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

  const refreshCards = useCallback(async () => {
    const profiles = await listCreditCards();
    setCards(profiles);
    return profiles;
  }, []);

  const refreshAnalysis = useCallback(async () => {
    if (transactionsLoading) return;
    const analysis = await analyzeCreditCards(buildCandidates());
    setCardAnalysis(analysis);
  }, [buildCandidates, transactionsLoading]);

  const runRecognition = useCallback(async () => {
    if (transactionsLoading) return;
    setLoading(true);
    try {
      const result = await suggestTransfers(buildCandidates());
      setMatches(result.matches);
      setSuggestions(result.suggestions);
      setClarifications(result.clarifications);
      await refreshAnalysis();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  }, [buildCandidates, refreshAnalysis, transactionsLoading]);

  useEffect(() => {
    void refreshCards().catch(error =>
      setMessage(error instanceof Error ? error.message : 'Fehler'),
    );
  }, [refreshCards]);

  useEffect(() => {
    if (!transactionsLoading) {
      void runRecognition();
    }
  }, [runRecognition, transactionsLoading]);

  const saveCard = async () => {
    if (!cardAccountId) {
      setMessage('Bitte ein Kreditkartenkonto auswählen.');
      return;
    }
    try {
      await upsertCreditCard({
        actualAccountId: cardAccountId,
        fundingAccountId: fundingAccountId || null,
        label: cardLabel || accountsById.get(cardAccountId)?.name || null,
      });
      setCardAccountId('');
      setFundingAccountId('');
      setCardLabel('');
      await refreshCards();
      await runRecognition();
      setMessage('Kreditkartenkonto gespeichert.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    }
  };

  const confirmMatch = async (id: string) => {
    const overview = await confirmTransferSuggestion(id);
    setMatches(overview.matches);
    setClarifications(overview.clarifications);
    await refreshAnalysis();
  };

  const unlink = async (id: string) => {
    const overview = await removeTransfer(id);
    setMatches(overview.matches);
    setClarifications(overview.clarifications);
    await refreshAnalysis();
  };

  const resolveCase = async (
    caseId: string,
    action: 'confirm' | 'dismiss',
    kind?: TransferMatchKind,
  ) => {
    const overview = await resolveTransferCase(
      caseId,
      action === 'dismiss'
        ? { action: 'dismiss' }
        : { action: 'confirm', kind },
    );
    setMatches(overview.matches);
    setClarifications(overview.clarifications);
    await refreshAnalysis();
  };

  const accountOptions: Array<readonly [string, string]> = [
    ['', 'Konto auswählen'],
    ...accounts
      .filter(account => !account.closed && !account.tombstone)
      .map(account => [account.id, account.name] as const),
  ];
  const fundingOptions: Array<readonly [string, string]> = [
    ['', 'Kein festes Abbuchungskonto'],
    ...accounts
      .filter(
        account =>
          !account.closed &&
          !account.tombstone &&
          account.id !== cardAccountId,
      )
      .map(account => [account.id, account.name] as const),
  ];

  const proposalMatches = matches.filter(match => match.status === 'proposed');
  const confirmedMatches = matches.filter(match => match.status === 'confirmed');
  const openCases = clarifications.filter(item => item.status === 'open');

  return (
    <Page header="ActualForge · Umbuchungen & Kreditkarten">
      <View style={{ maxWidth: 1220, paddingBottom: 30, gap: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="normal" onPress={() => void navigate('/actualforge')}>
            ← Übersicht
          </Button>
          <Button
            variant="normal"
            onPress={() => void navigate('/actualforge/payment-chains')}
          >
            Zahlungsketten
          </Button>
          <Button
            variant="primary"
            isDisabled={loading || transactionsLoading}
            onPress={() => void runRecognition()}
          >
            {loading ? 'Prüfe…' : 'Umbuchungen neu prüfen'}
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
              Kreditkartenkonten
            </Text>
            <Text style={{ opacity: 0.7 }}>
              Karteneinkäufe bleiben echte Ausgaben. Die spätere Zahlung vom
              Girokonto auf die Kreditkarte wird als interne Umbuchung behandelt
              und nicht ein zweites Mal als Aufwand gezählt.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Select
                value={cardAccountId}
                options={accountOptions}
                onChange={value => {
                  setCardAccountId(value);
                  setCardLabel(accountsById.get(value)?.name ?? '');
                  setFundingAccountId('');
                }}
                style={{ minWidth: 240 }}
              />
              <Select
                value={fundingAccountId}
                options={fundingOptions}
                onChange={setFundingAccountId}
                style={{ minWidth: 240 }}
              />
              <Input
                value={cardLabel}
                placeholder="Bezeichnung"
                onChangeValue={setCardLabel}
              />
              <Button variant="primary" onPress={() => void saveCard()}>
                Kreditkarte speichern
              </Button>
            </View>

            {cards.length === 0 && (
              <Text style={{ opacity: 0.7 }}>
                Noch kein Konto als Kreditkarte markiert.
              </Text>
            )}

            {cards.map(card => {
              const analysis = cardAnalysis.find(
                item => item.actualAccountId === card.actualAccountId,
              );
              return (
                <View
                  key={card.actualAccountId}
                  style={{
                    borderTop: `1px solid ${theme.tableBorder}`,
                    paddingTop: 9,
                    gap: 5,
                  }}
                >
                  <Text style={{ fontWeight: 600 }}>
                    {card.label ||
                      accountsById.get(card.actualAccountId)?.name ||
                      card.actualAccountId}
                  </Text>
                  <Text style={{ opacity: 0.7 }}>
                    Abbuchungskonto:{' '}
                    {card.fundingAccountId
                      ? accountsById.get(card.fundingAccountId)?.name ??
                        card.fundingAccountId
                      : 'nicht festgelegt'}
                  </Text>
                  {analysis && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <Text>
                        Käufe: <strong>{formatAmount(analysis.purchaseTotalMinor)}</strong>
                      </Text>
                      <Text>
                        Erstattungen:{' '}
                        <strong>{formatAmount(analysis.refundTotalMinor)}</strong>
                      </Text>
                      <Text>
                        Abrechnungszahlungen:{' '}
                        <strong>{formatAmount(analysis.paymentTotalMinor)}</strong>
                      </Text>
                      <Text>
                        Wirtschaftlicher Aufwand:{' '}
                        <strong>{formatAmount(analysis.economicExpenseMinor)}</strong>
                      </Text>
                    </View>
                  )}
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button
                      variant="normal"
                      onPress={() =>
                        void removeCreditCard(card.actualAccountId).then(
                          async () => {
                            await refreshCards();
                            await runRecognition();
                          },
                        )
                      }
                    >
                      Kreditkarten-Markierung entfernen
                    </Button>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        {proposalMatches.length > 0 && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 14, gap: 9 }}>
              <Text style={{ fontSize: 16, fontWeight: 600 }}>
                Sichere Vorschläge
              </Text>
              <Text style={{ opacity: 0.7 }}>
                Diese Paare passen gut zusammen, wurden aber nicht automatisch
                bestätigt.
              </Text>
              {proposalMatches.map(match => {
                const source = transactionsById.get(
                  match.sourceActualTransactionId,
                );
                const target = transactionsById.get(
                  match.targetActualTransactionId,
                );
                const sourcePayee = source?.payee
                  ? payeesById.get(source.payee)?.name
                  : undefined;
                const targetPayee = target?.payee
                  ? payeesById.get(target.payee)?.name
                  : undefined;
                return (
                  <View
                    key={match.id}
                    style={{
                      borderTop: `1px solid ${theme.tableBorder}`,
                      paddingTop: 8,
                      gap: 5,
                    }}
                  >
                    <Text style={{ fontWeight: 600 }}>
                      {KIND_LABELS[match.kind]} ·{' '}
                      {Math.round((match.confidence ?? 0) * 100)} %
                    </Text>
                    <Text>
                      {transactionLabel(
                        source,
                        source
                          ? accountsById.get(source.account)?.name ?? source.account
                          : '',
                        sourcePayee,
                      )}
                    </Text>
                    <Text>
                      ↳{' '}
                      {transactionLabel(
                        target,
                        target
                          ? accountsById.get(target.account)?.name ?? target.account
                          : '',
                        targetPayee,
                      )}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button
                        variant="primary"
                        onPress={() => void confirmMatch(match.id)}
                      >
                        Verknüpfen
                      </Button>
                      <Button variant="normal" onPress={() => void unlink(match.id)}>
                        Vorschlag entfernen
                      </Button>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {openCases.length > 0 && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 14, gap: 9 }}>
              <Text style={{ fontSize: 16, fontWeight: 600 }}>Klärfälle</Text>
              <Text style={{ opacity: 0.7 }}>
                Mehrdeutige oder schwächere Treffer werden nicht automatisch
                verknüpft.
              </Text>
              {openCases.map(item => {
                const payload = item.payload as {
                  source?: TransferCandidate;
                  target?: TransferCandidate;
                  suggestedKind?: TransferMatchKind;
                };
                const source = payload.source
                  ? transactionsById.get(payload.source.actualTransactionId)
                  : undefined;
                const target = payload.target
                  ? transactionsById.get(payload.target.actualTransactionId)
                  : undefined;
                return (
                  <View
                    key={item.id}
                    style={{
                      borderTop: `1px solid ${theme.tableBorder}`,
                      paddingTop: 8,
                      gap: 5,
                    }}
                  >
                    <Text style={{ fontWeight: 600 }}>
                      {KIND_LABELS[payload.suggestedKind ?? 'internal_transfer']} ·{' '}
                      {Math.round((item.confidence ?? 0) * 100)} %
                    </Text>
                    <Text>
                      {source
                        ? transactionLabel(
                            source,
                            accountsById.get(source.account)?.name ?? source.account,
                            source.payee
                              ? payeesById.get(source.payee)?.name
                              : undefined,
                          )
                        : 'Quellbuchung'}
                    </Text>
                    <Text>
                      ↳{' '}
                      {target
                        ? transactionLabel(
                            target,
                            accountsById.get(target.account)?.name ?? target.account,
                            target.payee
                              ? payeesById.get(target.payee)?.name
                              : undefined,
                          )
                        : 'Zielbuchung'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        variant="primary"
                        onPress={() =>
                          void resolveCase(
                            item.id,
                            'confirm',
                            payload.suggestedKind,
                          )
                        }
                      >
                        Verknüpfen
                      </Button>
                      <Button
                        variant="normal"
                        onPress={() => void resolveCase(item.id, 'dismiss')}
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
              Bestätigte Umbuchungen ({confirmedMatches.length})
            </Text>
            <Text style={{ opacity: 0.7 }}>
              Diese Buchungspaare bleiben in Actual unverändert. ActualForge
              interpretiert ihren wirtschaftlichen Effekt als 0 €.
            </Text>
            {confirmedMatches.length === 0 && (
              <Text style={{ opacity: 0.7 }}>
                Noch keine bestätigten Umbuchungen.
              </Text>
            )}
            {confirmedMatches.map(match => {
              const source = transactionsById.get(
                match.sourceActualTransactionId,
              );
              const target = transactionsById.get(
                match.targetActualTransactionId,
              );
              return (
                <View
                  key={match.id}
                  style={{
                    borderTop: `1px solid ${theme.tableBorder}`,
                    paddingTop: 8,
                    gap: 4,
                  }}
                >
                  <Text style={{ fontWeight: 600 }}>
                    {KIND_LABELS[match.kind]} · {formatAmount(match.amountMinor)}
                  </Text>
                  <Text>
                    {source
                      ? transactionLabel(
                          source,
                          accountsById.get(source.account)?.name ?? source.account,
                          source.payee
                            ? payeesById.get(source.payee)?.name
                            : undefined,
                        )
                      : match.sourceActualTransactionId}
                  </Text>
                  <Text>
                    ↳{' '}
                    {target
                      ? transactionLabel(
                          target,
                          accountsById.get(target.account)?.name ?? target.account,
                          target.payee
                            ? payeesById.get(target.payee)?.name
                            : undefined,
                        )
                      : match.targetActualTransactionId}
                  </Text>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button variant="normal" onPress={() => void unlink(match.id)}>
                      Verknüpfung lösen
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
