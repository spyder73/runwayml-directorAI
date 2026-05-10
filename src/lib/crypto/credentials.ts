import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type EncryptedCredential = {
  encrypted: string;
  iv: string;
  tag: string;
};

function credentialKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required to encrypt API credentials.');
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  return key;
}

export function encryptCredential(plainText: string): EncryptedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

export function decryptCredential(input: EncryptedCredential) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    credentialKey(),
    Buffer.from(input.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(input.tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(input.encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
