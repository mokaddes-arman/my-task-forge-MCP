import path from 'node:path';
import { config } from 'dotenv';

// Load the application credentials once, relative to the project root.
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

function normalisePath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

export const env = {
  baseURL: (process.env.BASE_URL ?? 'https://mytaskforge.net/').trim(),
  workspacePath: normalisePath(
    (process.env.WORKSPACE_PATH ?? '/abdul-s-workspace').trim(),
  ),
  ownerEmail: (process.env.owner_email ?? '').trim(),
  ownerPassword: (process.env.owner_password ?? '').trim(),
};

export const AUTH_DIR = path.resolve(process.cwd(), 'playwright', '.auth');
export const STORAGE_STATE = path.join(AUTH_DIR, 'user.json');

export interface OwnerCredentials {
  email: string;
  password: string;
}

/**
 * Returns the owner credentials and fails with a helpful message when `.env`
 * is incomplete. The password is never included in error output.
 */
export function ownerCredentials(): OwnerCredentials {
  if (!env.ownerEmail || !env.ownerPassword) {
    throw new Error(
      'Missing owner_email and/or owner_password. Add both to .env at the project root.',
    );
  }

  return {
    email: env.ownerEmail,
    password: env.ownerPassword,
  };
}
