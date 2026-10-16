import { hash, verify } from '@node-rs/argon2';

// Argon2id with the library's secure defaults (memory-hard, salted automatically).
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used when the email does not exist, so a failed login takes about the same
// time either way (prevents discovering which emails are registered by timing).
let dummyHash: Promise<string> | undefined;
export async function fakeVerify(password: string): Promise<void> {
  dummyHash ??= hash('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
