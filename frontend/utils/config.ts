/**
 * config.ts — Single source of truth for BACKEND_URL.
 *
 * Priority order (highest → lowest):
 *   1. app.json  expo.extra.backendUrl   — set this per EAS build profile
 *   2. EXPO_PUBLIC_BACKEND_URL           — set in frontend/.env for local dev
 *   3. FALLBACK_URL                      — update this to your current Codespaces URL
 *
 * ── How to configure ────────────────────────────────────────────────────────
 *
 * LOCAL DEV (Codespaces):
 *   Create frontend/.env:
 *     EXPO_PUBLIC_BACKEND_URL=https://<your-codespace>-8001.app.github.dev
 *   Then restart Expo with: npx expo start --clear
 *
 * EAS PREVIEW BUILD:
 *   Set in app.json → expo.extra.backendUrl   OR
 *   Use eas.json env block:
 *     "preview": { "env": { "EXPO_PUBLIC_BACKEND_URL": "https://your-server.com" } }
 *
 * ── FALLBACK (update whenever your Codespaces URL changes) ──────────────────
 *   This is only used when neither of the above is set.
 *   Leave blank to get an obvious error rather than silent wrong-server calls.
 */

import Constants from 'expo-constants';

const FALLBACK_URL = '';   // ← paste your Codespaces backend URL here for quick dev

export const BACKEND_URL: string =
  (Constants.expoConfig?.extra?.backendUrl as string | undefined) ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  FALLBACK_URL;

if (!BACKEND_URL) {
  console.warn(
    '[config] BACKEND_URL is not set. ' +
    'Set EXPO_PUBLIC_BACKEND_URL in frontend/.env or update FALLBACK_URL in utils/config.ts'
  );
}

export default BACKEND_URL;
