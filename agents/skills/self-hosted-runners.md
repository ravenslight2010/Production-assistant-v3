# Skill: set up and use self-hosted runners

Use when the Windows 10 or Windows 11 workflows need a machine, or when a
self-hosted job is queued and not starting.

## What these runners do

`windows-10.yml` and `windows-11.yml` run the app and server on a labeled
self-hosted Windows machine. They are required (blocking) once a runner with
the matching label is online. If no runner is online, the job stays queued.

Android Chrome and Safari iOS workflows run on GitHub-hosted runners and do
not need self-hosted machines.

## Install a runner

1. On the Windows machine, open
   https://github.com/ravenslight2010/Production-assistant-v3/settings/actions/runners
2. Click **New self-hosted runner**, choose **Windows** / **x64**.
3. Follow the download and configure steps.
4. Add the label that matches the machine:
   - Windows 10 machine: `windows-10`
   - Windows 11 machine: `windows-11`
5. Install and start as a service so it survives reboots:
   ```
   .\config.cmd --url https://github.com/ravenslight2010/Production-assistant-v3 --token YOUR_TOKEN --labels windows-10 --runasservice
   ```
   Use `windows-11` on the other machine.

Full notes: [docs/self-hosted-runners.md](../../docs/self-hosted-runners.md).

## Requirements on the machine

- Node.js matching `.nvmrc`
- pnpm
- Git
- The runner service account can reach `localhost:3000`

## After the runner is online

Push or open a PR. The matching Windows workflow should leave the queue and
run. A red Windows job blocks merge the same way a red `Test` job does.

## If a job stays queued

- Confirm the runner service is running on the machine.
- Confirm the label on the runner matches the workflow (`windows-10` or
  `windows-11`).
- Check the runner page in repo settings for offline or busy status.
