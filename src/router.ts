// Veil routing policy: decides where a task runs. Pure function, easy to test.

export type TaskId = 'summarize' | 'plain' | 'reply' | 'translate' | 'actions';
export type Route = 'on_device' | 'cloud_masked' | 'blocked';

export interface Policy {
  /** Max characters we send to Gemini Nano (on-device token limit is ~9k tokens). */
  localCharLimit: number;
  /** Tasks considered "heavy" that we prefer to send (masked) to the cloud model. */
  heavyTasks: TaskId[];
  /** If true, never use the cloud, even with masking. */
  strictLocal: boolean;
  cloudModel: string;
}

export const DEFAULT_POLICY: Policy = {
  localCharLimit: 6000,
  heavyTasks: ['reply'],
  strictLocal: false,
  cloudModel: 'gemini-3.5-flash-lite',
};

export interface RouteInput {
  chars: number;
  task: TaskId;
  online: boolean;
  deviceModel: 'available' | 'downloadable' | 'downloading' | 'unavailable';
  policy: Policy;
}

export interface Decision { route: Route; reason: string }

export function decideRoute(i: RouteInput): Decision {
  const localReady = i.deviceModel === 'available';
  const fitsLocal = i.chars <= i.policy.localCharLimit;
  const heavy = i.policy.heavyTasks.includes(i.task);

  if (!i.online) {
    if (localReady && fitsLocal) return { route: 'on_device', reason: 'Offline: running on Gemini Nano.' };
    return { route: 'blocked', reason: localReady ? 'Offline and the document is too long for the on-device model.' : 'Offline and no on-device model is ready.' };
  }
  if (i.policy.strictLocal) {
    if (localReady && fitsLocal) return { route: 'on_device', reason: 'Strict local mode: nothing leaves this device.' };
    return { route: 'blocked', reason: 'Strict local mode is on, but the on-device model cannot handle this request.' };
  }
  if (localReady && fitsLocal && !heavy) {
    return { route: 'on_device', reason: 'Short task: Gemini Nano handles it privately and for free.' };
  }
  const why = !localReady ? 'on-device model not ready' : !fitsLocal ? `document longer than ${i.policy.localCharLimit} chars` : 'task needs a larger model';
  return { route: 'cloud_masked', reason: `Cloud (${why}). Only the masked text is sent.` };
}
