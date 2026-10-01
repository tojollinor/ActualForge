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
