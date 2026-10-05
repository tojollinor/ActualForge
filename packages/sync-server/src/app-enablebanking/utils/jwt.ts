import { createPrivateKey } from 'node:crypto';

import { sign } from 'jws';
import type { Algorithm } from 'jws';

type Header = { typ: string; alg: Algorithm; kid: string };

type JWTPayload = {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function getJWTHeader(applicationId: string): Header {
  return { typ: 'JWT', alg: 'RS256', kid: applicationId };
}

function getJWTBody(exp = 3600): JWTPayload {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: timestamp,
    exp: timestamp + exp,
  };
}

function exportPkcs8Pem(secretKey: Parameters<typeof createPrivateKey>[0]): string {
  const key = createPrivateKey(secretKey);
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error('Enable Banking requires an RSA private key');
  }

  const exported = key.export({
    format: 'pem',
    type: 'pkcs8',
  });

  return typeof exported === 'string'
    ? exported
    : exported.toString('utf8');
}

export function normalizeEnableBankingPrivateKey(secretKey: string): string {
  if (typeof secretKey !== 'string' || secretKey.trim().length === 0) {
    throw new Error('Enable Banking private key is empty');
  }

  const normalizedText = secretKey
    .trim()
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');

  try {
    return exportPkcs8Pem(normalizedText);
  } catch {
    const compact = normalizedText.replace(/\s+/g, '');

    try {
      const der = Buffer.from(compact, 'base64');
      if (der.length === 0) {
        throw new Error('empty key');
      }

      try {
        return exportPkcs8Pem({
          key: der,
          format: 'der',
          type: 'pkcs8',
        });
      } catch {
        return exportPkcs8Pem({
          key: der,
          format: 'der',
          type: 'pkcs1',
        });
      }
    } catch {
      throw new Error(
        'Invalid Enable Banking private key. Use an RSA private key in PEM format or paste its base64 DER content.',
      );
    }
  }
}

export function getJWT(
  applicationId: string,
  secretKey: string,
  exp = 3600,
): string {
  return sign({
    header: getJWTHeader(applicationId),
    payload: getJWTBody(exp),
    secret: secretKey,
  });
}
