# Veil: ask AI about private documents without giving them away

Veil is a Chrome web app for people who need help understanding sensitive paperwork (clinic results,
lease notices, HR and visa emails, bank letters) but should not paste that paperwork into a cloud chatbot.

It uses **Firebase AI Logic hybrid inference** in a deliberate way: the on-device model is not just a
cheaper fallback, it is the **privacy boundary**.

1. **Scan on device.** Gemini Nano (Chrome Prompt API, via Firebase AI Logic `ONLY_ON_DEVICE`) plus local
   rules find names, addresses, ID numbers, phone numbers, card numbers, dates and links. Structured
   JSON output is constrained with a schema, and every span is checked against the source text.
2. **Review.** The user sees each detected item and the exact masked text. Nothing has left the device yet.
3. **Route.** A small, testable router decides where the task runs:
   * short tasks run on Gemini Nano (`PREFER_ON_DEVICE`): free, offline-capable, private;
   * long documents or heavy tasks go to Gemini in the cloud (`ONLY_IN_CLOUD`) with **masked text only**;
   * offline or "strict local" mode never touches the cloud.
4. **Rehydrate locally.** Placeholders like `[PERSON_1]` in the answer are swapped back to the real
   values on the device, so the user reads a normal answer.
5. **Privacy ledger.** Every request records where it ran (`response.inferenceSource`) and, for cloud
   calls, the exact payload that was sent, so the user can verify the claim instead of trusting it.

## Who it is for

More than 3.5 million foreign residents live in Japan (Immigration Services Agency figures), and many of them receive important letters in a
language they do not read well. Today the easy option is to photograph or paste the letter into a cloud
AI, together with their name, My Number, insurance number and bank details. Veil gives them the same
help while keeping identifiers on their own machine. The same pattern applies to anyone handling
patient, tenant or employee data.

## How Firebase AI Logic is used

| Where | API | Mode |
| --- | --- | --- |
| `src/ai.ts` PII detector | `getGenerativeModel(ai, { mode: ONLY_ON_DEVICE, onDeviceParams: { promptOptions: { responseConstraint } } })` | on-device only, JSON schema |
| `src/ai.ts` short tasks | `getGenerativeModel(ai, { mode: PREFER_ON_DEVICE, inCloudParams })` | hybrid |
| `src/ai.ts` long or heavy tasks | `getGenerativeModel(ai, { mode: ONLY_IN_CLOUD, inCloudParams })` | cloud, masked input |
| `src/ai.ts` warm-up | `model.initializeDeviceModel(onProgress)` on a button click | download progress |
| `src/main.ts` badge and ledger | `response.inferenceSource` | shows on-device vs cloud |
| `src/firebase.ts` | App Check (reCAPTCHA Enterprise, debug provider in dev) | required by AI Logic |
| `src/firebase.ts` | Remote Config: `local_char_limit`, `heavy_tasks`, `cloud_model` | routing policy without redeploy |

Backend: Gemini Developer API (`GoogleAIBackend`), default cloud model `gemini-3.5-flash-lite`.

## Run it

Requirements: Node 20+, Chrome desktop 139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled.

```bash
npm install
cp .env.example .env.local   # paste your Firebase web app config
npm run dev                  # http://localhost:5173
npm test                     # unit tests for masking, rehydration and routing
```

Firebase setup:

1. Create a Firebase project, open **AI Services > AI Logic > Get started**, choose **Gemini Developer API**.
2. Register a Web app and copy its config into `.env.local`.
3. App Check is enforced by the AI Logic setup. For local runs, copy the debug token printed in the
   browser console into **App Check > Apps > Manage debug tokens**. For hosting, add a reCAPTCHA
   Enterprise key as `VITE_RECAPTCHA_ENTERPRISE_KEY`.
4. Optional: create Remote Config parameters `local_char_limit` (number), `heavy_tasks` (comma list),
   `cloud_model` (string).
5. Deploy: `npm run build && npx firebase-tools deploy --only hosting`.

Without a Firebase config the app still scans and masks with local rules, but the Run button stays
disabled. It never fakes model output.

## Project layout

```
src/pii.ts       local detection, masking, rehydration, leak check (no network)
src/router.ts    pure routing policy (on device / cloud masked / blocked)
src/ai.ts        Firebase AI Logic hybrid models
src/firebase.ts  Firebase app, App Check, Remote Config
src/main.ts      UI
tests/           vitest unit tests
```

## Limits and next steps

* On-device inference is single-turn text and image only, about 9k tokens, Chrome desktop only.
* Rule-based detection is a safety net, not a guarantee. The review step exists for that reason.
* Next: image input (photo of a paper letter, JPEG/PNG works on device), Android and iOS clients
  with the same router.

## What was built during the submission period

All code in this repository was written from scratch during #BuildHybridAI 2026 (Nov 2026), with help
from AI coding assistants. Third-party code is limited to npm dependencies (Firebase JS SDK, Vite, Vitest).

## License

Apache-2.0. See [LICENSE](LICENSE).
