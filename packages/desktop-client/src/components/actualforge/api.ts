import { send } from '@actual-app/core/platform/client/connection';

export interface FinanceEngineHealth {
  status: string;
  service: string;
  version: string;
}

export interface FinanceEngineReady {
  status: string;
  service: string;
  schemaVersion?: number;
}

export interface FinanceEngineStatus {
  service: string;
  version: string;
  schemaVersion: number;
  persistence: string;
  actualIntegration: {
    baseUrl: string;
    access: string;
    transactionStorage: string;
    automaticTransactionMutation: boolean;
  };
}

export interface FinanceEngineCapabilities {
  domains: Record<string, string>;
  behavior: {
    ambiguousMatchesRequireClarification: boolean;
    originalActualTransactionsRemainAuthoritative: boolean;
  };
}

export interface ActualForgeOverview {
  health: FinanceEngineHealth;
  ready: FinanceEngineReady;
  status: FinanceEngineStatus;
  capabilities: FinanceEngineCapabilities;
}

export type ContractStatus = 'active' | 'paused' | 'cancelled' | 'archived';
export type ContractAmountMode = 'fixed' | 'variable';

export interface Contract {
  id: string;
  title: string;
  provider: string | null;
  kind: string | null;
  status: ContractStatus;
  accountId: string | null;
  payeeId: string | null;
  amountMinor: number | null;
  amountMode: ContractAmountMode;
  currency: string | null;
  recurrence: string | null;
  nextPaymentDate: string | null;
  startDate: string | null;
  endDate: string | null;
  minimumTermMonths: number | null;
  cancellationNoticeDays: number | null;
  cancellationDate: string | null;
  source: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  linkedTransactionCount: number;
  proposedTransactionCount: number;
}

export interface ContractPayload {
  title: string;
  provider?: string | null;
  kind?: string | null;
  status?: ContractStatus;
  accountId?: string | null;
  payeeId?: string | null;
  amountMinor?: number | null;
  amountMode?: ContractAmountMode;
  currency?: string | null;
  recurrence?: string | null;
  nextPaymentDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  minimumTermMonths?: number | null;
  cancellationNoticeDays?: number | null;
  cancellationDate?: string | null;
  notes?: string | null;
}

export interface ContractLink {
  id: string;
  actualTransactionId: string;
  linkType: string;
  amountMinor: number | null;
  confidence: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractPriceHistory {
  id: string;
  actualTransactionId: string | null;
  effectiveDate: string;
  amountMinor: number;
  currency: string | null;
  source: string;
  createdAt: string;
}

export interface ContractDetail {
  contract: Contract;
  links: ContractLink[];
  priceHistory: ContractPriceHistory[];
}

export interface TransactionCandidate {
  actualTransactionId: string;
  date: string;
  amountMinor: number;
  accountId: string;
  payeeId?: string | null;
  payeeName?: string | null;
  notes?: string | null;
}

export interface ContractSuggestion {
  actualTransactionId: string;
  score: number;
  reasons: string[];
  amountChange: boolean;
  proposedLinkId: string | null;
}

export async function loadActualForgeOverview(): Promise<ActualForgeOverview> {
  return (await send('actualforge-overview')) as ActualForgeOverview;
}

export async function listContracts(): Promise<Contract[]> {
  const result = (await send('actualforge-contracts-list')) as {
    contracts: Contract[];
  };
  return result.contracts;
}

export async function createContract(
  payload: ContractPayload,
): Promise<Contract> {
  const result = (await send(
    'actualforge-contract-create',
    { ...payload },
  )) as { contract: Contract };
  return result.contract;
}

export async function getContract(id: string): Promise<ContractDetail> {
  return (await send('actualforge-contract-get', { id })) as ContractDetail;
}

export async function updateContract(
  id: string,
  changes: Partial<ContractPayload>,
): Promise<Contract> {
  const result = (await send('actualforge-contract-update', {
    id,
    changes: { ...changes },
  })) as { contract: Contract };
  return result.contract;
}

export async function linkContractTransaction(
  id: string,
  link: {
    actualTransactionId: string;
    amountMinor?: number | null;
    date?: string | null;
    linkType?: string;
    confidence?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<ContractDetail> {
  const result = (await send('actualforge-contract-link', {
    id,
    link: { ...link },
  })) as { detail: ContractDetail };
  return result.detail;
}

export async function unlinkContractTransaction(
  id: string,
  linkId: string,
): Promise<void> {
  await send('actualforge-contract-unlink', { id, linkId });
}

export async function suggestContractTransactions(
  id: string,
  candidates: TransactionCandidate[],
): Promise<{
  suggestions: ContractSuggestion[];
  detail: ContractDetail;
}> {
  return (await send('actualforge-contract-suggestions', {
    id,
    candidates: candidates.map(candidate => ({ ...candidate })),
  })) as {
    suggestions: ContractSuggestion[];
    detail: ContractDetail;
  };
}


export type PaymentChainStatus =
  | 'open'
  | 'reversed'
  | 'settled'
  | 'failed'
  | 'needs_clarification';

export type PaymentRole =
  | 'payment_attempt'
  | 'reversal'
  | 'settlement'
  | 'fee'
  | 'failed';

export type SplitKind =
  | 'contract_amount'
  | 'return_fee'
  | 'bank_fee'
  | 'dunning_fee'
  | 'other_fee';

export interface PaymentChain {
  id: string;
  contractId: string | null;
  contractTitle: string | null;
  title: string | null;
  accountId: string | null;
  status: PaymentChainStatus;
  expectedAmountMinor: number | null;
  currency: string | null;
  dueDate: string | null;
  settledAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  linkCount: number;
  openClarificationCount: number;
}

export interface PaymentChainPayload {
  contractId?: string | null;
  title?: string | null;
  accountId?: string | null;
  expectedAmountMinor?: number | null;
  currency?: string | null;
  dueDate?: string | null;
}

export interface TransactionSplit {
  id: string;
  paymentChainId: string;
  transactionLinkId: string;
  actualTransactionId: string;
  kind: SplitKind;
  amountMinor: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionSplitPayload {
  kind: SplitKind;
  amountMinor: number;
  notes?: string | null;
}

export interface PaymentChainLink {
  id: string;
  actualTransactionId: string;
  role: PaymentRole;
  amountMinor: number | null;
  signedAmountMinor: number | null;
  occurredOn: string | null;
  confidence: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  splits: TransactionSplit[];
}

export interface PaymentChainClarification {
  id: string;
  paymentChainId: string;
  actualTransactionId: string | null;
  confidence: number | null;
  status: string;
  subject: string | null;
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentChainDetail {
  chain: PaymentChain;
  links: PaymentChainLink[];
  clarifications: PaymentChainClarification[];
  summary: {
    attemptCount: number;
    reversalCount: number;
    finalPaymentMinor: number;
    feeTotalMinor: number;
    economicTotalMinor: number;
    finalSettlementTransactionId: string | null;
  };
}

export interface PaymentChainSuggestion {
  actualTransactionId: string;
  role: PaymentRole;
  score: number;
  reasons: string[];
  clarificationCaseId: string | null;
}

export async function listPaymentChains(): Promise<PaymentChain[]> {
  const result = (await send('actualforge-payment-chains-list')) as {
    paymentChains: PaymentChain[];
  };
  return result.paymentChains;
}

export async function createPaymentChain(
  payload: PaymentChainPayload,
): Promise<PaymentChain> {
  const result = (await send(
    'actualforge-payment-chain-create',
    { ...payload },
  )) as { paymentChain: PaymentChain };
  return result.paymentChain;
}

export async function getPaymentChain(id: string): Promise<PaymentChainDetail> {
  return (await send('actualforge-payment-chain-get', { id })) as PaymentChainDetail;
}

export async function linkPaymentChainTransaction(
  id: string,
  link: {
    actualTransactionId: string;
    role: PaymentRole;
    amountMinor: number;
    date: string;
    confidence?: number | null;
    metadata?: Record<string, unknown> | null;
    splits?: TransactionSplitPayload[];
  },
): Promise<PaymentChainDetail> {
  return (await send('actualforge-payment-chain-link', {
    id,
    link: { ...link },
  })) as PaymentChainDetail;
}

export async function unlinkPaymentChainTransaction(
  id: string,
  linkId: string,
): Promise<PaymentChainDetail> {
  return (await send('actualforge-payment-chain-unlink', {
    id,
    linkId,
  })) as PaymentChainDetail;
}

export async function replacePaymentChainSplits(
  id: string,
  linkId: string,
  splits: TransactionSplitPayload[],
): Promise<PaymentChainDetail> {
  return (await send('actualforge-payment-chain-splits', {
    id,
    linkId,
    splits: splits.map(split => ({ ...split })),
  })) as PaymentChainDetail;
}

export async function suggestPaymentChainTransactions(
  id: string,
  candidates: TransactionCandidate[],
): Promise<{
  suggestions: PaymentChainSuggestion[];
  detail: PaymentChainDetail;
}> {
  return (await send('actualforge-payment-chain-suggestions', {
    id,
    candidates: candidates.map(candidate => ({ ...candidate })),
  })) as {
    suggestions: PaymentChainSuggestion[];
    detail: PaymentChainDetail;
  };
}

export async function resolvePaymentChainClarification(
  id: string,
  caseId: string,
  resolution:
    | { action: 'dismiss' }
    | {
        action: 'confirm';
        role: PaymentRole;
        amountMinor: number;
        date: string;
        splits?: TransactionSplitPayload[];
      },
): Promise<PaymentChainDetail> {
  return (await send('actualforge-payment-chain-clarification', {
    id,
    caseId,
    resolution: { ...resolution },
  })) as PaymentChainDetail;
}


export type TransferMatchKind = 'internal_transfer' | 'credit_card_payment';

export interface TransferCandidate extends TransactionCandidate {
  accountName?: string | null;
  transferId?: string | null;
  transferAccountId?: string | null;
}

export interface TransferMatch {
  id: string;
  sourceActualTransactionId: string;
  targetActualTransactionId: string;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  amountMinor: number | null;
  sourceDate: string | null;
  targetDate: string | null;
  kind: TransferMatchKind;
  confidence: number | null;
  status: 'proposed' | 'confirmed';
  confirmedAt: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferClarification {
  id: string;
  status: string;
  subject: string | null;
  confidence: number | null;
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferSuggestion {
  sourceActualTransactionId: string;
  targetActualTransactionId: string;
  kind: TransferMatchKind;
  score: number;
  reasons: string[];
  matchId: string | null;
  status: 'proposed' | 'confirmed' | 'clarification';
  clarificationCaseId: string | null;
}

export interface CreditCardProfile {
  actualAccountId: string;
  fundingAccountId: string | null;
  label: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardAnalysis extends CreditCardProfile {
  purchaseCount: number;
  purchaseTotalMinor: number;
  refundCount: number;
  refundTotalMinor: number;
  paymentCount: number;
  paymentTotalMinor: number;
  economicExpenseMinor: number;
  paymentTransactionIds: string[];
}

export interface TransferOverview {
  matches: TransferMatch[];
  clarifications: TransferClarification[];
  creditCards: CreditCardAnalysis[];
}

export async function loadTransferOverview(): Promise<TransferOverview> {
  return (await send('actualforge-transfers-overview')) as TransferOverview;
}

export async function suggestTransfers(
  candidates: TransferCandidate[],
): Promise<{
  suggestions: TransferSuggestion[];
  matches: TransferMatch[];
  clarifications: TransferClarification[];
}> {
  return (await send('actualforge-transfer-suggestions', {
    candidates: candidates.map(candidate => ({ ...candidate })),
  })) as {
    suggestions: TransferSuggestion[];
    matches: TransferMatch[];
    clarifications: TransferClarification[];
  };
}

export async function confirmTransferSuggestion(
  id: string,
): Promise<TransferOverview> {
  const result = (await send('actualforge-transfer-confirm', { id })) as {
    overview: TransferOverview;
  };
  return result.overview;
}

export async function removeTransfer(
  id: string,
): Promise<TransferOverview> {
  return (await send('actualforge-transfer-remove', { id })) as TransferOverview;
}

export async function resolveTransferCase(
  caseId: string,
  resolution:
    | { action: 'dismiss' }
    | { action: 'confirm'; kind?: TransferMatchKind },
): Promise<TransferOverview> {
  return (await send('actualforge-transfer-clarification', {
    caseId,
    resolution: { ...resolution },
  })) as TransferOverview;
}

export async function listCreditCards(): Promise<CreditCardProfile[]> {
  const result = (await send('actualforge-credit-cards-list')) as {
    creditCards: CreditCardProfile[];
  };
  return result.creditCards;
}

export async function upsertCreditCard(input: {
  actualAccountId: string;
  fundingAccountId?: string | null;
  label?: string | null;
}): Promise<CreditCardProfile> {
  const result = (await send('actualforge-credit-card-upsert', {
    ...input,
  })) as { creditCard: CreditCardProfile };
  return result.creditCard;
}

export async function removeCreditCard(accountId: string): Promise<void> {
  await send('actualforge-credit-card-remove', { accountId });
}

export async function analyzeCreditCards(
  candidates: TransferCandidate[],
): Promise<CreditCardAnalysis[]> {
  const result = (await send('actualforge-credit-card-analysis', {
    candidates: candidates.map(candidate => ({ ...candidate })),
  })) as { creditCards: CreditCardAnalysis[] };
  return result.creditCards;
}
