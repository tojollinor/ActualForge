import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Card } from '@actual-app/components/card';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { Page } from '#components/Page';
import { useNavigate } from '#hooks/useNavigate';

import {
  loadActualForgeOverview,
  loadAirtableStatus,
  syncActualCoreToAirtable,
  type ActualCoreAirtableStatus,
  type ActualForgeOverview,
} from './api';

type OverviewState =
  | { status: 'loading' }
  | { status: 'ready'; data: ActualForgeOverview }
  | { status: 'error'; message: string };

const capabilityLabels: Record<string, string> = {
  contracts: 'Contracts',
  paymentChains: 'Payment chains',
  transactionLinks: 'Transaction links',
  transactionSplits: 'Transaction splits',
  transferMatches: 'Transfer matching',
  creditCards: 'Credit cards',
  clarificationCases: 'Clarification cases',
  predictions: 'Predictions',
  forecasts: 'Forecasts',
  merchantMappings: 'Merchant mappings',
  recognitionRules: 'Recognition rules',
};

function StatusCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card style={{ flex: '1 1 220px', minWidth: 0, margin: 0 }}>
      <View style={{ padding: 14, gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>{title}</Text>
        <Text style={{ fontSize: 18 }}>{value}</Text>
        <Text style={{ opacity: 0.7 }}>{description}</Text>
      </View>
    </Card>
  );
}

export function ActualForgePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<OverviewState>({
    status: 'loading',
  });
  const [airtableStatus, setAirtableStatus] =
    useState<ActualCoreAirtableStatus | null>(null);
  const [airtableSyncing, setAirtableSyncing] = useState(false);
  const [airtableMessage, setAirtableMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setOverview({ status: 'loading' });

    try {
      const data = await loadActualForgeOverview();
      setOverview({ status: 'ready', data });
      if (data.status.airtableIntegration?.actualCore) {
        setAirtableStatus(data.status.airtableIntegration.actualCore);
      }
    } catch (error) {
      setOverview({
        status: 'error',
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncAirtable = useCallback(async () => {
    setAirtableSyncing(true);
    setAirtableMessage(null);
    try {
      const result = await syncActualCoreToAirtable();
      setAirtableStatus(result.status);
      setAirtableMessage(
        `${result.counts.accounts} Konten · ${result.counts.transactions} Buchungen · ${result.counts.categories} Kategorien · ${result.counts.schedules} Zeitpläne übergeben`,
      );
    } catch (error) {
      setAirtableMessage(
        error instanceof Error ? error.message : 'Airtable-Synchronisation fehlgeschlagen',
      );
    } finally {
      setAirtableSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (
      !airtableStatus ||
      (!airtableStatus.processing && airtableStatus.pendingBatches === 0)
    ) {
      return;
    }

    const timer = setInterval(() => {
      void loadAirtableStatus()
        .then(setAirtableStatus)
        .catch(() => undefined);
    }, 2000);

    return () => clearInterval(timer);
  }, [airtableStatus]);

  return (
    <Page header="ActualForge">
      <View style={{ maxWidth: 980, paddingBottom: 30, gap: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: 600 }}>
            ActualForge-Finanzlogik
          </Text>
          <Text style={{ opacity: 0.75 }}>
            Actual bleibt die führende Quelle für Buchungen. ActualForge ergänzt
            Verträge, Zuordnungen, Klärfälle und Prognosen in derselben
            Oberfläche.
          </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              variant="primary"
              onPress={() => void navigate('/actualforge/contracts')}
            >
              Verträge öffnen
            </Button>
            <Button
              variant="normal"
              onPress={() => void navigate('/actualforge/payment-chains')}
            >
              Zahlungsketten
            </Button>
            <Button
              variant="normal"
              onPress={() => void navigate('/actualforge/transfers')}
            >
              Umbuchungen & Kreditkarten
            </Button>
            <Button
              variant="normal"
              onPress={() => void navigate('/actualforge/forecast')}
            >
              Prognose & Klärfälle
            </Button>
            {overview.status === 'ready' &&
              overview.data.status.airtableIntegration?.enabled && (
                <Button variant="normal" onPress={() => void syncAirtable()}>
                  {airtableSyncing
                    ? 'Airtable wird vorbereitet…'
                    : 'Airtable synchronisieren'}
                </Button>
              )}
          </View>
        </View>

        {overview.status === 'loading' && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 16 }}>
              <Text>{t('Connecting to the finance engine…')}</Text>
            </View>
          </Card>
        )}

        {overview.status === 'error' && (
          <Card style={{ margin: 0 }}>
            <View style={{ padding: 16, gap: 10 }}>
              <Text style={{ fontWeight: 600 }}>
                {t('Finance engine is not available')}
              </Text>
              <Text style={{ opacity: 0.75 }}>
                {t(
                  'Actual itself can continue to run. ActualForge features need the finance-engine service.',
                )}
              </Text>
              <Text style={{ opacity: 0.6 }}>{overview.message}</Text>
              <View style={{ alignItems: 'flex-start' }}>
                <Button variant="normal" onPress={() => void refresh()}>
                  {t('Try again')}
                </Button>
              </View>
            </View>
          </Card>
        )}

        {overview.status === 'ready' && (
          <>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <StatusCard
                title={t('Finance engine')}
                value={
                  overview.data.health.status === 'ok'
                    ? t('Connected')
                    : overview.data.health.status
                }
                description={`v${overview.data.status.version}`}
              />
              <StatusCard
                title={t('Database')}
                value={
                  overview.data.ready.status === 'ready'
                    ? t('Ready')
                    : overview.data.ready.status
                }
                description={`${overview.data.status.persistence} · schema ${overview.data.status.schemaVersion}`}
              />
              <StatusCard
                title={t('Actual transactions')}
                value={t('Authoritative')}
                description={
                  overview.data.status.actualIntegration
                    .automaticTransactionMutation
                    ? t('Automatic mutation enabled')
                    : t('Automatic mutation disabled')
                }
              />
              {overview.data.status.airtableIntegration && (
                <StatusCard
                  title="Airtable"
                  value={
                    !overview.data.status.airtableIntegration.configured
                      ? 'Nicht konfiguriert'
                      : airtableStatus?.processing ||
                          (airtableStatus?.pendingBatches ?? 0) > 0
                        ? 'Synchronisiert…'
                        : airtableStatus?.lastError
                          ? 'Fehler'
                          : 'Bereit'
                  }
                  description={
                    airtableStatus?.processing ||
                    (airtableStatus?.pendingBatches ?? 0) > 0
                      ? `${airtableStatus?.pendingBatches ?? 0} Pakete in der Warteschlange`
                      : airtableStatus?.lastError ??
                        `${airtableStatus?.syncedRecords ?? 0} Datensätze übertragen`
                  }
                />
              )}
            </View>

            {airtableMessage && (
              <Card style={{ margin: 0 }}>
                <View style={{ padding: 12 }}>
                  <Text>{airtableMessage}</Text>
                </View>
              </Card>
            )}

            <Card style={{ margin: 0 }}>
              <View style={{ padding: 16, gap: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <View style={{ gap: 3 }}>
                    <Text style={{ fontSize: 16, fontWeight: 600 }}>
                      Aktive Module
                    </Text>
                    <Text style={{ opacity: 0.7 }}>
                      Diese Funktionen laufen über die interne Finance Engine,
                      bleiben aber vollständig in der ActualForge-Oberfläche.
                    </Text>
                  </View>
                  <Button variant="normal" onPress={() => void refresh()}>
                    {t('Refresh')}
                  </Button>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  {Object.entries(overview.data.capabilities.domains).map(
                    ([domain, status]) => (
                      <View
                        key={domain}
                        style={{
                          flex: '1 1 210px',
                          minWidth: 0,
                          padding: 10,
                          border: `1px solid ${theme.cardBorder}`,
                          borderRadius: 5,
                          gap: 3,
                        }}
                      >
                        <Text style={{ fontWeight: 600 }}>
                          {capabilityLabels[domain] ?? domain}
                        </Text>
                        <Text style={{ opacity: 0.65 }}>{status}</Text>
                      </View>
                    ),
                  )}
                </View>
              </View>
            </Card>
          </>
        )}
      </View>
    </Page>
  );
}
