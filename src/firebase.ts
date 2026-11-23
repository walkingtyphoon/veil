// Firebase bootstrap: App, App Check (required by Firebase AI Logic), Remote Config.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { DEFAULT_POLICY, type Policy, type TaskId } from './router';

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_APP_ID);

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  if (app) return app;
  app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  // Local development: let the App Check debug provider print a token to the console.
  if (env.DEV || env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_KEY || 'debug'),
    isTokenAutoRefreshEnabled: true,
  });
  return app;
}

/** Routing policy from Remote Config, so thresholds can change without a redeploy. */
export async function loadPolicy(): Promise<Policy> {
  const a = getFirebaseApp();
  if (!a) return DEFAULT_POLICY;
  try {
    const rc = getRemoteConfig(a);
    rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
    rc.defaultConfig = {
      local_char_limit: DEFAULT_POLICY.localCharLimit,
      heavy_tasks: DEFAULT_POLICY.heavyTasks.join(','),
      cloud_model: DEFAULT_POLICY.cloudModel,
    };
    await fetchAndActivate(rc);
    return {
      ...DEFAULT_POLICY,
      localCharLimit: getValue(rc, 'local_char_limit').asNumber() || DEFAULT_POLICY.localCharLimit,
      heavyTasks: getValue(rc, 'heavy_tasks').asString().split(',').map((s) => s.trim()).filter(Boolean) as TaskId[],
      cloudModel: getValue(rc, 'cloud_model').asString() || DEFAULT_POLICY.cloudModel,
    };
  } catch (err) {
    console.warn('Remote Config unavailable, using defaults', err);
    return DEFAULT_POLICY;
  }
}
