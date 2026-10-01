import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

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
import { useAccounts } from '#hooks/useAccounts';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { useTransactions } from '#hooks/useTransactions';
import * as queries from '#queries';

import {
  createContract,
  getContract,
  linkContractTransaction,
  listContracts,
  suggestContractTransactions,
  unlinkContractTransaction,
  updateContract,
  type Contract,
  type ContractAmountMode,
  type ContractDetail,
  type ContractPayload,
  type ContractStatus,
  type ContractSuggestion,
  type TransactionCandidate,
} from './api';

type ContractDraft = {
  title: string;
  provider: string;
  kind: string;
  status: ContractStatus;
  accountId: string;
  payeeId: string;
  amount: string;
  amountMode: ContractAmountMode;
  currency: string;
  recurrence: string;
  nextPaymentDate: string;
  startDate: string;
  endDate: string;
  minimumTermMonths: string;
  cancellationNoticeDays: string;
  cancellationDate: string;
  notes: string;
};

const EMPTY_DRAFT: ContractDraft = {
  title: '',
  provider: '',
  kind: 'other',
  status: 'active',
  accountId: '',
  payeeId: '',
  amount: '',
  amountMode: 'fixed',
  currency: 'EUR',
  recurrence: 'monthly',
  nextPaymentDate: '',
  startDate: '',
  endDate: '',
  minimumTermMonths: '',
  cancellationNoticeDays: '',
  cancellationDate: '',
  notes: '',
};

const CONTRACT_TYPES = [
  ['subscription', 'Abonnement'],
  ['insurance', 'Versicherung'],
  ['utility', 'Versorgung'],
  ['telecom', 'Telekommunikation'],
  ['rent', 'Miete'],
  ['loan', 'Kredit'],
  ['membership', 'Mitgliedschaft'],
  ['service', 'Dienstleistung'],
  ['other', 'Sonstiges'],
] as const;

const RECURRENCES = [
  ['weekly', 'Wöchentlich'],
  ['monthly', 'Monatlich'],
  ['quarterly', 'Vierteljährlich'],
  ['semiannual', 'Halbjährlich'],
  ['annual', 'Jährlich'],
  ['irregular', 'Unregelmäßig'],
  ['none', 'Keine Wiederholung'],
] as const;

const STATUSES: Array<readonly [ContractStatus, string]> = [
  ['active', 'Aktiv'],
  ['paused', 'Pausiert'],
  ['cancelled', 'Gekündigt'],
  ['archived', 'Archiviert'],
];

const AMOUNT_MODES: Array<readonly [ContractAmountMode, string]> = [
  ['fixed', 'Fester Betrag'],
  ['variable', 'Variabler Betrag'],
];

function formatAmount(amountMinor: number | null, currency = 'EUR') {
  if (amountMinor == null) return '–';
  return `${integerToCurrencyWithDecimal(Math.abs(amountMinor), currency)} ${currency}`;
}

function toDraft(contract: Contract): ContractDraft {
  return {
    title: contract.title,
    provider: contract.provider ?? '',
    kind: contract.kind ?? 'other',
    status: contract.status,
    accountId: contract.accountId ?? '',
    payeeId: contract.payeeId ?? '',
    amount:
      contract.amountMinor == null
        ? ''
        : integerToCurrencyWithDecimal(
            contract.amountMinor,
            contract.currency ?? 'EUR',
          ),
    amountMode: contract.amountMode,
    currency: contract.currency ?? 'EUR',
    recurrence: contract.recurrence ?? 'monthly',
    nextPaymentDate: contract.nextPaymentDate ?? '',
    startDate: contract.startDate ?? '',
    endDate: contract.endDate ?? '',
    minimumTermMonths:
      contract.minimumTermMonths == null
        ? ''
        : String(contract.minimumTermMonths),
    cancellationNoticeDays:
      contract.cancellationNoticeDays == null
        ? ''
        : String(contract.cancellationNoticeDays),
    cancellationDate: contract.cancellationDate ?? '',
    notes: contract.notes ?? '',
  };
}

function toPayload(draft: ContractDraft): ContractPayload {
  const amountMinor =
    draft.amount.trim() === '' ? null : currencyToInteger(draft.amount);

  if (draft.amount.trim() !== '' && amountMinor == null) {
    throw new Error('Ungültiger Betrag');
  }

  const integerOrNull = (value: string) =>
    value.trim() === '' ? null : Number.parseInt(value, 10);

  return {
    title: draft.title,
    provider: draft.provider || null,
    kind: draft.kind || null,
    status: draft.status,
    accountId: draft.accountId || null,
    payeeId: draft.payeeId || null,
    amountMinor,
    amountMode: draft.amountMode,
    currency: draft.currency || 'EUR',
    recurrence: draft.recurrence || null,
    nextPaymentDate: draft.nextPaymentDate || null,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    minimumTermMonths: integerOrNull(draft.minimumTermMonths),
    cancellationNoticeDays: integerOrNull(draft.cancellationNoticeDays),
    cancellationDate: draft.cancellationDate || null,
    notes: draft.notes || null,
  };
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <View style={{ flex: wide ? '1 1 100%' : '1 1 220px', gap: 4 }}>
      <Text style={{ fontWeight: 600 }}>{label}</Text>
      {children}
    </View>
  );
}

function transactionLabel(
  transaction: TransactionEntity | undefined,
  payeeName: string | undefined,
) {
  if (!transaction) return 'Buchung nicht im aktuellen Ausschnitt';
  return `${transaction.date} · ${payeeName || transaction.imported_payee || 'Ohne Zahlungsempfänger'} · ${formatAmount(transaction.amount)}`;
}

export function ContractsPage() {
  const { t } = useTranslation();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [draft, setDraft] = useState<ContractDraft>(EMPTY_DRAFT);
  const [isCreating, setIsCreating] = useState(false);
  const [suggestions, setSuggestions] = useState<ContractSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const items = await listContracts();
    setContracts(items);
    setSelectedId(current =>
      current && items.some(item => item.id === current)
        ? current
        : items[0]?.id ?? null,
    );
    return items;
  }, []);

  useEffect(() => {
    void refreshList()
      .catch(error =>
        setMessage(error instanceof Error ? error.message : 'Fehler'),
      )
      .finally(() => setLoading(false));
  }, [refreshList]);

  const refreshDetail = useCallback(async (id: string) => {
    const value = await getContract(id);
    setDetail(value);
    setDraft(toDraft(value.contract));
    return value;
  }, []);

  useEffect(() => {
    if (!selectedId || isCreating) {
      setDetail(null);
      setSuggestions([]);
      return;
    }

    void refreshDetail(selectedId).catch(error =>
      setMessage(error instanceof Error ? error.message : 'Fehler'),
    );
  }, [isCreating, refreshDetail, selectedId]);

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
    if (!selectedId || isCreating || transactionsLoading) return;

    const result = await suggestContractTransactions(
      selectedId,
      buildCandidates(),
    );
    setSuggestions(result.suggestions);
    setDetail(result.detail);
  }, [
    buildCandidates,
    isCreating,
    selectedId,
    transactionsLoading,
  ]);

  useEffect(() => {
    if (selectedId && !isCreating && !transactionsLoading) {
      void refreshSuggestions().catch(() => {
        // The contract page remains usable if suggestion generation fails.
      });
    }
  }, [isCreating, refreshSuggestions, selectedId, transactionsLoading]);

  const startCreate = () => {
    setIsCreating(true);
    setSelectedId(null);
    setDetail(null);
    setSuggestions([]);
    setDraft({ ...EMPTY_DRAFT });
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = toPayload(draft);
      if (!payload.title.trim()) {
        throw new Error('Vertragsname fehlt');
      }

      if (isCreating) {
        const created = await createContract(payload);
        await refreshList();
        setIsCreating(false);
        setSelectedId(created.id);
        await refreshDetail(created.id);
        setMessage('Vertrag angelegt');
      } else if (selectedId) {
        await updateContract(selectedId, payload);
        await refreshList();
        await refreshDetail(selectedId);
        setMessage('Vertrag gespeichert');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fehler');
    } finally {
      setSaving(false);
    }
  };

  const confirmSuggestion = async (suggestion: ContractSuggestion) => {
    if (!selectedId) return;
    const transaction = transactionsById.get(suggestion.actualTransactionId);
    if (!transaction) return;

    const nextDetail = await linkContractTransaction(selectedId, {
      actualTransactionId: transaction.id,
      amountMinor: transaction.amount,
      date: transaction.date,
      confidence: suggestion.score,
      metadata: {
        reasons: suggestion.reasons,
        amountChange: suggestion.amountChange,
      },
    });
    setDetail(nextDetail);
    await refreshList();
    await refreshSuggestions();
  };

  const removeLink = async (linkId: string) => {
    if (!selectedId) return;
    await unlinkContractTransaction(selectedId, linkId);
    await refreshDetail(selectedId);
    await refreshList();
    await refreshSuggestions();
  };

  const accountOptions: Array<readonly [string, string]> = [
    ['', 'Kein Konto'],
    ...accounts
      .filter(account => !account.closed)
      .map(account => [account.id, account.name] as const),
  ];
  const payeeOptions: Array<readonly [string, string]> = [
    ['', 'Kein Zahlungsempfänger'],
    ...payees
      .filter(payee => !payee.tombstone && !payee.transfer_acct)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(payee => [payee.id, payee.name] as const),
  ];

  return (
    <Page header="ActualForge · Verträge">
      <View style={{ maxWidth: 1180, paddingBottom: 30, gap: 14 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'space-between',
          }}
        >
          <Button variant="normal" onPress={() => void navigate('/actualforge')}>
            ← Übersicht
          </Button>
          <Button variant="primary" onPress={startCreate}>
            + Vertrag anlegen
          </Button>
        </View>

        {message && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 10 }}>
              <Text>{message}</Text>
            </View>
          </Card>
        )}

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <Card style={{ margin: 0, flex: '1 1 300px', minWidth: 260 }}>
            <View style={{ padding: 12, gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: 600 }}>
                Verträge ({contracts.length})
              </Text>
              {loading && <Text>Lade Verträge…</Text>}
              {!loading && contracts.length === 0 && (
                <Text style={{ opacity: 0.7 }}>
                  Noch keine Verträge vorhanden.
                </Text>
              )}
              {contracts.map(contract => (
                <Button
                  key={contract.id}
                  variant={
                    selectedId === contract.id && !isCreating
                      ? 'menuSelected'
                      : 'menu'
                  }
                  onPress={() => {
                    setIsCreating(false);
                    setSelectedId(contract.id);
                    setMessage(null);
                  }}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  <View style={{ alignItems: 'flex-start', gap: 2 }}>
                    <Text style={{ fontWeight: 600 }}>
                      {contract.provider || contract.title}
                    </Text>
                    <Text style={{ opacity: 0.7 }}>
                      {contract.provider ? contract.title + ' · ' : ''}
                      {formatAmount(
                        contract.amountMinor,
                        contract.currency ?? 'EUR',
                      )}
                      {' · '}
                      {contract.recurrence ?? 'ohne Intervall'}
                    </Text>
                    {(contract.proposedTransactionCount > 0 ||
                      contract.status !== 'active') && (
                      <Text style={{ opacity: 0.7 }}>
                        {contract.status !== 'active'
                          ? contract.status
                          : ''}
                        {contract.proposedTransactionCount > 0
                          ? `${contract.status !== 'active' ? ' · ' : ''}${contract.proposedTransactionCount} Vorschlag/Vorschläge`
                          : ''}
                      </Text>
                    )}
                  </View>
                </Button>
              ))}
            </View>
          </Card>

          <View style={{ flex: '3 1 620px', minWidth: 0, gap: 14 }}>
            {(isCreating || detail) && (
              <Card style={{ margin: 0 }}>
                <View style={{ padding: 14, gap: 12 }}>
                  <Text style={{ fontSize: 17, fontWeight: 600 }}>
                    {isCreating
                      ? 'Neuer Vertrag'
                      : detail?.contract.title ?? 'Vertrag'}
                  </Text>

                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <Field label="Vertragsname">
                      <Input
                        value={draft.title}
                        onChangeValue={value =>
                          setDraft(current => ({ ...current, title: value }))
                        }
                      />
                    </Field>
                    <Field label="Anbieter">
                      <Input
                        value={draft.provider}
                        onChangeValue={value =>
                          setDraft(current => ({ ...current, provider: value }))
                        }
                      />
                    </Field>
                    <Field label="Vertragsart">
                      <Select
                        value={draft.kind}
                        options={[...CONTRACT_TYPES]}
                        onChange={value =>
                          setDraft(current => ({ ...current, kind: value }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Status">
                      <Select
                        value={draft.status}
                        options={STATUSES}
                        onChange={value =>
                          setDraft(current => ({ ...current, status: value }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Konto">
                      <Select
                        value={draft.accountId}
                        options={accountOptions}
                        onChange={value =>
                          setDraft(current => ({ ...current, accountId: value }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Zahlungsempfänger">
                      <Select
                        value={draft.payeeId}
                        options={payeeOptions}
                        onChange={value =>
                          setDraft(current => ({ ...current, payeeId: value }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Erwarteter Betrag">
                      <Input
                        value={draft.amount}
                        placeholder="0,00"
                        onChangeValue={value =>
                          setDraft(current => ({ ...current, amount: value }))
                        }
                      />
                    </Field>
                    <Field label="Betragsart">
                      <Select
                        value={draft.amountMode}
                        options={AMOUNT_MODES}
                        onChange={value =>
                          setDraft(current => ({
                            ...current,
                            amountMode: value,
                          }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Währung">
                      <Input
                        value={draft.currency}
                        onChangeValue={value =>
                          setDraft(current => ({
                            ...current,
                            currency: value.toUpperCase().slice(0, 3),
                          }))
                        }
                      />
                    </Field>
                    <Field label="Zahlungsintervall">
                      <Select
                        value={draft.recurrence}
                        options={[...RECURRENCES]}
                        onChange={value =>
                          setDraft(current => ({
                            ...current,
                            recurrence: value,
                          }))
                        }
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="Nächste Zahlung">
                      <Input
                        type="date"
                        value={draft.nextPaymentDate}
                        onChangeValue={value =>
                          setDraft(current => ({
                            ...current,
                            nextPaymentDate: value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Vertragsbeginn">
                      <Input
                        type="date"
                        value={draft.startDate}
                        onChangeValue={value =>
                          setDraft(current => ({ ...current, startDate: value }))
                        }
                      />
                    </Field>
                    <Field label="Vertragsende">
                      <Input
                        type="date"
                        value={draft.endDate}
                        onChangeValue={value =>
                          setDraft(current => ({ ...current, endDate: value }))
                        }
                      />
                    </Field>
                    <Field label="Mindestlaufzeit (Monate)">
                      <Input
                        type="number"
                        min={0}
                        value={draft.minimumTermMonths}
                        onChangeValue={value =>
                          setDraft(current => ({
                            ...current,
                            minimumTermMonths: value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Kündigungsfrist (Tage)">
                      <Input
                        type="number"
                        min={0}
                        value={draft.cancellationNoticeDays}
                        onChangeValue={value =>
                          setDraft(current => ({
                            ...current,
                            cancellationNoticeDays: value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Kündigungsdatum">
                      <Input
                        type="date"
                        value={draft.cancellationDate}
                        onChangeValue={value =>
                          setDraft(current => ({
                            ...current,
                            cancellationDate: value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Notizen" wide>
                      <textarea
                        value={draft.notes}
                        onChange={event =>
                          setDraft(current => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        rows={4}
                        style={{
                          resize: 'vertical',
                          borderRadius: 4,
                          border: `1px solid ${theme.formInputBorder}`,
                          background: theme.tableBackground,
                          color: theme.formInputText,
                          padding: 8,
                          font: 'inherit',
                        }}
                      />
                    </Field>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      variant="primary"
                      isDisabled={saving}
                      onPress={() => void save()}
                    >
                      {saving ? 'Speichere…' : 'Speichern'}
                    </Button>
                    {isCreating && (
                      <Button
                        variant="normal"
                        onPress={() => {
                          setIsCreating(false);
                          void refreshList();
                        }}
                      >
                        Abbrechen
                      </Button>
                    )}
                  </View>
                </View>
              </Card>
            )}

            {!isCreating && detail && (
              <>
                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <View style={{ gap: 2 }}>
                        <Text style={{ fontSize: 16, fontWeight: 600 }}>
                          Buchungsvorschläge
                        </Text>
                        <Text style={{ opacity: 0.7 }}>
                          Wiederkehrende Actual-Buchungen werden lokal bewertet.
                          Vorschläge verändern die Buchung selbst nicht.
                        </Text>
                      </View>
                      <Button
                        variant="normal"
                        onPress={() => void refreshSuggestions()}
                      >
                        Neu prüfen
                      </Button>
                    </View>

                    {suggestions.length === 0 && (
                      <Text style={{ opacity: 0.7 }}>
                        Keine passenden offenen Vorschläge.
                      </Text>
                    )}

                    {suggestions.map(suggestion => {
                      const transaction = transactionsById.get(
                        suggestion.actualTransactionId,
                      );
                      const payeeName = transaction?.payee
                        ? payeesById.get(transaction.payee)?.name
                        : transaction?.imported_payee;
                      return (
                        <View
                          key={suggestion.actualTransactionId}
                          style={{
                            borderTop: `1px solid ${theme.cardBorder}`,
                            paddingTop: 9,
                            gap: 5,
                          }}
                        >
                          <Text style={{ fontWeight: 600 }}>
                            {transactionLabel(transaction, payeeName)}
                          </Text>
                          <Text style={{ opacity: 0.7 }}>
                            Treffer: {Math.round(suggestion.score * 100)} %
                            {suggestion.amountChange
                              ? ' · Preisänderung prüfen'
                              : ''}
                          </Text>
                          <Text style={{ opacity: 0.6 }}>
                            {suggestion.reasons.join(', ')}
                          </Text>
                          <View style={{ alignItems: 'flex-start' }}>
                            <Button
                              variant="primary"
                              onPress={() =>
                                void confirmSuggestion(suggestion)
                              }
                            >
                              Zuordnung bestätigen
                            </Button>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </Card>

                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 9 }}>
                    <Text style={{ fontSize: 16, fontWeight: 600 }}>
                      Zugeordnete Buchungen
                    </Text>
                    {detail.links.filter(link => link.status === 'confirmed')
                      .length === 0 && (
                      <Text style={{ opacity: 0.7 }}>
                        Noch keine bestätigten Buchungen.
                      </Text>
                    )}
                    {detail.links
                      .filter(link => link.status === 'confirmed')
                      .map(link => {
                        const transaction = transactionsById.get(
                          link.actualTransactionId,
                        );
                        const payeeName = transaction?.payee
                          ? payeesById.get(transaction.payee)?.name
                          : transaction?.imported_payee;
                        return (
                          <View
                            key={link.id}
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              borderTop: `1px solid ${theme.cardBorder}`,
                              paddingTop: 8,
                            }}
                          >
                            <Text>
                              {transactionLabel(transaction, payeeName)}
                            </Text>
                            <Button
                              variant="normal"
                              onPress={() => void removeLink(link.id)}
                            >
                              Zuordnung lösen
                            </Button>
                          </View>
                        );
                      })}
                  </View>
                </Card>

                <Card style={{ margin: 0 }}>
                  <View style={{ padding: 14, gap: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: 600 }}>
                      Preisentwicklung
                    </Text>
                    {detail.priceHistory.length === 0 && (
                      <Text style={{ opacity: 0.7 }}>
                        Der Preisverlauf entsteht aus bestätigten Buchungen.
                      </Text>
                    )}
                    {detail.priceHistory.map(entry => (
                      <View
                        key={entry.id}
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          gap: 10,
                          borderTop: `1px solid ${theme.cardBorder}`,
                          paddingTop: 7,
                        }}
                      >
                        <Text>{entry.effectiveDate}</Text>
                        <Text style={{ fontWeight: 600 }}>
                          {formatAmount(
                            entry.amountMinor,
                            entry.currency ?? detail.contract.currency ?? 'EUR',
                          )}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            )}

            {!loading && !isCreating && !detail && contracts.length === 0 && (
              <Card style={{ margin: 0 }}>
                <View style={{ padding: 16 }}>
                  <Text>
                    Lege den ersten Vertrag an, um wiederkehrende Zahlungen mit
                    Actual-Buchungen zu verknüpfen.
                  </Text>
                </View>
              </Card>
            )}
          </View>
        </View>
      </View>
    </Page>
  );
}
