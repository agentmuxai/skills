# AgentMux computer-use skills

Per-application knowledge for agents that drive desktop apps: how to control the app, best route first (its own API, a plug-in, shortcuts, then clicks), its traps, and a check after each step. Each one is a standard [Agent Skill](https://agentskills.io/) folder, so any agent that reads `SKILL.md` can use it, plus a small manifest AgentMux reads.

They are installed on demand from **Memory > Skills > Browse** in [AgentMux](https://github.com/agentmuxai/agentmux), not shipped in the app. A skill grants nothing: the person still grants control of each app, and AgentMux checks every download's hash and signature before it asks.

## How it works

- Each skill is a folder in [`skills/`](skills/), named `<publisher>-<id>`, with its `SKILL.md`, `computer-use.json` (manifest), `test.json` and optional `skill.sig` and scripts.
- [`publishers.json`](publishers.json) lists each publisher's signing key.
- [`verification/`](verification/) holds pass records from machines that have the app: skill version, app version, platform, date.
- On every change to `main`, CI checks every skill (`scripts/build.mjs`), writes `index.json` and a zip per signed skill, signs `index.json` with the catalog key, and publishes them at `https://agentmuxai.github.io/skills/`.
- A skill from AgentMux's own publisher shows an **AgentMux** badge; a community skill shows the author's key fingerprint. An unsigned skill is never listed.

## Use one without AgentMux

Copy a folder from [`skills/`](skills/) into your agent's skills directory (for example `.claude/skills/`). Only `SKILL.md` and the files it points to are read; the manifest is ignored by other readers.

## Add a skill

1. Read [`guide/write-a-skill/SKILL.md`](guide/write-a-skill/SKILL.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
2. Make `skills/<publisher>-<id>/`, then fill in the script hashes: `node scripts/skill-sign.mjs hashes skills/<publisher>-<id>`.
3. Make a key once and sign the folder as the last step:
   ```bash
   node scripts/skill-sign.mjs keygen ~/.agentmux-skill-key.json
   node scripts/skill-sign.mjs sign skills/<publisher>-<id> --key ~/.agentmux-skill-key.json
   ```
4. Open a pull request that adds the folder and, the first time, your key to `publishers.json`. Sign off your commits (`git commit -s`).

CI checks the format, the signature, that scripts are listed with their hashes, and that nothing reads secrets or has an agent type one. Every pull request is reviewed before it merges; a script, an MCP pointer or a change to a publisher key gets extra scrutiny.

## Build and test locally

```bash
node --test scripts/lib.test.mjs
node scripts/build.mjs --out dist
```

Licence: Apache-2.0.
