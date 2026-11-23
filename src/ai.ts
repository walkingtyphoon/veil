// All model calls go through Firebase AI Logic (firebase/ai) hybrid inference.
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { getFirebaseApp } from './firebase';
import { parseModelEntities, type Entity } from './pii';
import type { Policy, TaskId } from './router';

export type DeviceState = 'available' | 'downloadable' | 'downloading' | 'unavailable';

declare const LanguageModel: { availability(opts?: object): Promise<DeviceState> } | undefined;

export async function deviceModelState(): Promise<DeviceState> {
  try {
    if (typeof LanguageModel === 'undefined') return 'unavailable';
    return await LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

// JSON Schema for Chrome's Prompt API responseConstraint (on-device structured output).
const ENTITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['PERSON', 'ADDRESS', 'ORG', 'ID_NUMBER', 'DATE', 'OTHER'] },
          text: { type: 'string' },
        },
        required: ['type', 'text'],
      },
    },
  },
  required: ['entities'],
};

let detector: GenerativeModel | null = null;
let hybrid: GenerativeModel | null = null;
let cloud: GenerativeModel | null = null;
let cloudModelName = '';

function ai() {
  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase is not configured (see .env.example).');
  return getAI(app, { backend: new GoogleAIBackend() });
}

export function buildModels(policy: Policy) {
  const a = ai();
  // 1) PII detector: ONLY on device. Raw text must never reach the cloud.
  detector = getGenerativeModel(a, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { promptOptions: { responseConstraint: ENTITY_JSON_SCHEMA } },
  });
  // 2) Task model for short jobs: prefer Gemini Nano, SDK falls back to cloud if needed.
  //    We only ever pass masked text to it, so a fallback is still private.
  hybrid = getGenerativeModel(a, { mode: InferenceMode.PREFER_ON_DEVICE, inCloudParams: { model: policy.cloudModel } });
  // 3) Task model for long or heavy jobs: cloud only, masked text only.
  cloud = getGenerativeModel(a, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: policy.cloudModel } });
  cloudModelName = policy.cloudModel;
}

/** Must be called from a user gesture (button click). */
export async function warmUpDevice(onProgress: (p: number) => void) {
  if (!detector || !hybrid) throw new Error('Models not built');
  await detector.initializeDeviceModel(onProgress);
  await hybrid.initializeDeviceModel();
}

export async function detectWithNano(text: string): Promise<Entity[]> {
  if (!detector) return [];
  const prompt =
    'Find personal or sensitive information in the text below: people\'s names, street addresses, ' +
    'organisation names tied to a person, ID or account numbers, and birth dates. ' +
    'Copy each item exactly as written. Return JSON {"entities":[{"type","text"}]}.\n\nTEXT:\n' + text;
  const res = await detector.generateContent(prompt);
  return parseModelEntities(res.response.text(), text);
}

const TASK_PROMPTS: Record<TaskId, string> = {
  summarize: 'Summarize this document in 5 short bullet points.',
  plain: 'Explain this document in plain, simple English for a non-native speaker. Define any jargon.',
  reply: 'Draft a polite, clear reply to this message. Keep placeholders like [PERSON_1] exactly as they are.',
  translate: 'Translate this document into natural English.',
  actions: 'List every deadline, payment and action the reader must take, as a checklist with dates.',
};

export interface TaskResult { text: string; source: 'on_device' | 'in_cloud'; model: string; ms: number }

export async function runTask(task: TaskId, maskedText: string, where: 'on_device' | 'cloud_masked'): Promise<TaskResult> {
  const model = where === 'on_device' ? hybrid : cloud;
  if (!model) throw new Error('Models not built');
  const prompt =
    TASK_PROMPTS[task] +
    '\nPlaceholders in square brackets (for example [PERSON_1]) stand for private values. Keep them unchanged.\n\nDOCUMENT:\n' +
    maskedText;
  const t0 = performance.now();
  const res = await model.generateContent(prompt);
  const source = res.response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud';
  return {
    text: res.response.text(),
    source,
    model: source === 'on_device' ? 'Gemini Nano (Chrome)' : cloudModelName,
    ms: Math.round(performance.now() - t0),
  };
}
