# Self-hosted runners for Windows 10 and 11

These runners let the Windows 10 and Windows 11 workflows run the app and server on your machines.

## Install on each Windows machine

1. Open https://github.com/ravenslight2010/Production-assistant-v3/settings/actions/runners
2. Click **New self-hosted runner**
3. Choose **Windows** and **x64**
4. Follow the download and configure steps
5. When configuring, add a label:
   - On the Windows 10 machine: `windows-10`
   - On the Windows 11 machine: `windows-11`
6. Install and start the runner as a service:
   ```
   .\config.cmd --url https://github.com/ravenslight2010/Production-assistant-v3 --token YOUR_TOKEN --labels windows-10 --runasservice
   ```
   (use `windows-11` on the other machine)

## Requirements on the machine

- Node.js (version matching `.nvmrc`)
- pnpm
- Git
- The runner service account must be able to reach `localhost:3000`

## Notes

- The workflows are required (they block merges) once the runners are online.
- If a runner is offline, the job stays queued until it comes back.
- Android testing uses Chromium mobile viewports on Linux (no physical device).
- iOS testing uses Playwright WebKit on a GitHub macOS runner (Safari engine only).
