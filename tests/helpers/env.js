'use strict';

const path = require('node:path');
const { config } = require('dotenv');

// Load the application credentials once, relative to the project root.
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

function normalisePath(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

const env = {
  baseURL: (process.env.BASE_URL ?? 'https://mytaskforge.net/').trim(),
  workspacePath: normalisePath(
    (process.env.WORKSPACE_PATH ?? '/abdul-s-workspace').trim(),
  ),
  ownerEmail: (process.env.owner_email ?? '').trim(),
  ownerPassword: (process.env.owner_password ?? '').trim(),
};

const AUTH_DIR = path.resolve(process.cwd(), 'playwright', '.auth');
const STORAGE_STATE = path.join(AUTH_DIR, 'user.json');

/**
 * Returns the owner credentials and fails with a helpful message when `.env`
 * is incomplete. The password is never included in error output.
 */
function ownerCredentials() {
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

module.exports = {
  env,
  AUTH_DIR,
  STORAGE_STATE,
  ownerCredentials,
};
