# Devpost submission draft (do not submit without Jack)

**Project name:** Veil
**Tagline:** Ask AI about private documents without giving them away.
**Platform category:** Web (Chrome)
**Built with:** Firebase AI Logic, Gemini Nano (Chrome Prompt API), Gemini Developer API, Firebase App Check,
Firebase Remote Config, Firebase Hosting, TypeScript, Vite

## Inspiration
Foreign residents, patients and tenants regularly receive letters they cannot fully read. The fastest
help is a cloud chatbot, but that means uploading a name, ID numbers and bank details. We wanted the
help without the leak.

## What it does
See README "How it works": on-device scan, review, hybrid routing, local rehydration, privacy ledger.

## How we built it
Firebase AI Logic is called in three modes: ONLY_ON_DEVICE for detection with a JSON responseConstraint,
PREFER_ON_DEVICE for short tasks, ONLY_IN_CLOUD for long masked tasks. inferenceSource drives the UI
badge and the ledger. App Check protects the API; Remote Config holds the routing policy.

## Challenges
Making the on-device output trustworthy: every span the model returns is verified against the source
text, rules backstop the model, and a final leak check blocks a request if any private value remains.

## What's next
Photo input for paper letters, Android and iOS clients with the same router.

**Links to fill:** GitHub repo URL, hosted URL, YouTube URL.
