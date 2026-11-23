# Demo video plan (target 2:30, hard limit 3:00, English captions)

Recording: Chrome desktop window, 1920x1080, ffmpeg x11grab on the box display (or Jack's Mac with
QuickTime if Gemini Nano cannot run on the box). Voice-over: English TTS or captions burned in with ffmpeg.

| Time | Shot | Caption |
| --- | --- | --- |
| 0:00-0:15 | Photo-style clinic letter with name, insurance no., My Number | "Millions of people paste letters like this into cloud AI." |
| 0:15-0:30 | Veil header, status chips: Gemini Nano available, Firebase AI Logic connected | "Veil uses Firebase AI Logic hybrid inference. The on-device model is the privacy boundary." |
| 0:30-1:00 | Click Scan. Entities appear (rule + Nano tags). Masked text view | "Gemini Nano finds private data on this device. Nothing has left the laptop." |
| 1:00-1:25 | Pick "Explain in plain English". Route card: On this device. Run. Badge: on-device | "Short tasks run on Gemini Nano: free and private." |
| 1:25-1:55 | Paste the long lease notice, pick "Draft a reply". Route: Cloud, masked. Run. Badge: cloud. Open ledger | "Long or heavy jobs go to Gemini in the cloud, with masked text only. The ledger shows exactly what was sent." |
| 1:55-2:15 | Answer shows real names restored locally | "Placeholders are swapped back on the device." |
| 2:15-2:30 | Turn Wi-Fi off (DevTools offline). Route switches to on-device; strict local toggle | "Offline or strict mode: the cloud is never used." |
| 2:30-2:40 | Remote Config change of local_char_limit, repo URL, license | "Policy comes from Remote Config. Open source, Apache-2.0." |

Commands (box):

```bash
ffmpeg -video_size 1920x1080 -framerate 30 -f x11grab -i $DISPLAY -c:v libx264 -preset veryfast -crf 20 raw.mp4
ffmpeg -i raw.mp4 -vf "subtitles=captions.srt" -c:a copy veil-demo.mp4
```

Upload: YouTube, public (Jack's account), link goes into the Devpost form.
