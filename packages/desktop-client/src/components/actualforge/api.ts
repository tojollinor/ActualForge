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

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `request_failed_${response.status}`;
    throw new Error(error);
  }

  return payload as T;
}

export async function loadActualForgeOverview(): Promise<ActualForgeOverview> {
  const [health, ready, status, capabilities] = await Promise.all([
    requestJson<FinanceEngineHealth>('/actualforge/api/engine/health'),
    requestJson<FinanceEngineReady>('/actualforge/api/engine/ready'),
    requestJson<FinanceEngineStatus>('/actualforge/api/engine/status'),
    requestJson<FinanceEngineCapabilities>(
      '/actualforge/api/engine/capabilities',
    ),
  ]);

  return { health, ready, status, capabilities };
}
