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
  clarificationCases: 'Clarification cases',
  predictions: 'Predictions',
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

  const refresh = useCallback(async () => {
    setOverview({ status: 'loading' });

    try {
      const data = await loadActualForgeOverview();
      setOverview({ status: 'ready', data });
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
            {t('Finance interpretation layer')}
          </Text>
          <Text style={{ opacity: 0.75 }}>
            {t(
              'Actual keeps the original transactions. ActualForge adds reversible interpretation, matching and forecasting on top.',
            )}
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
            </View>

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
                      {t('Prepared modules')}
                    </Text>
                    <Text style={{ opacity: 0.7 }}>
                      {t(
                        'These modules have their persistence boundary in place. Their workflows are added in the following blocks.',
                      )}
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
