import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;

function encode(value: Buffer) {
  return value.toString('base64url');
}

function decode(value: string) {
  return Buffer.from(value, 'base64url');
}

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Password must be at least 8 characters.');
  }

  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${encode(salt)}$${encode(hash)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);

  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const salt = decode(saltRaw);
    const storedHash = decode(hashRaw);
    const candidateHash = await scrypt(password, salt, storedHash.length, { N: n, r, p });

    if (candidateHash.length !== storedHash.length) {
      return false;
    }

    return timingSafeEqual(candidateHash, storedHash);
  } catch {
    return false;
  }
}
