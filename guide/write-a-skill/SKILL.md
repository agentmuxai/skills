---
name: write-a-skill
description: Use when asked to write, review or update a computer-use skill: the per-application knowledge an agent loads before it drives a desktop app (Word, Excel, Ableton Live, Blender or any other). Gives the folder layout, the control ladder, the manifest, and how to keep unverified steps out.
---

# Write a computer-use skill

**Status:** active — the guide for writing a computer-use skill.

A **computer-use skill** is per-application knowledge for an agent that drives a desktop app: how to control it, best route first, its keys, its traps, and a check after each step. It is a standard Agent Skill (a `SKILL.md` folder that any Agent Skills reader can use) plus a small manifest, `computer-use.json`, that AgentMux reads for its card, version and test records. In the AgentMux UI it shows in Memory > Skills with an "App" badge.

## What to write

A folder named `<publisher>-<id>` (for example `acme-word`), with:

- `SKILL.md`: the frontmatter (`name` equal to the folder name, and a `description` that names the app and its executable so an agent knows when to load it), then the ladder, shortcuts, pitfalls, a verify table and the proof line. Keep it short (under 500 lines, ideally under 60 for the router); an agent reads all of it. Put detail in reference files (`controls.md`, `keys.md`, `pitfalls.md`, `verify.md`) one level deep and point to them.
- `computer-use.json`: `schema` `computer-use-skill/v1`, `publisher`, `id`, `name`, `version` (semver), `changelog` (the last entry is the current version), `app` (`vendor`, `executables` per platform, `titleHints`, `versions` with `supported` and `tested`), `platforms`, `ladder`, `mcp` (a catalog id, never a command), and `scripts` (every script file with its `sha256`, a `purpose` of `test` or `helper`, and what it `needs`; a script that uses the network lists `network:<origin>`). `node scripts/skill-sign.mjs hashes <folder>` fills in the hashes.
- `test.json`: the skill's test task, its steps and the verify cues, written so a machine can check them (a file, a window title, a script result).

## The ladder, in this order, in every skill

1. The app's own API or scripting.
2. A plug-in or MCP server (named by catalog id; the person approves its install).
3. Keyboard shortcuts and menu paths.
4. `Desktop` clicks, with a screenshot after each action.

## Rules

- **Only steps you saw succeed go in as fact.** Anything taken from documentation, a forum or memory stays, but says where it came from and that it is unverified. A skill with no passing test says "Verified on: none yet".
- **A skill grants nothing.** Never write "the grant is not needed". Say the person's per-app grant is needed.
- **Never put a password, key, licence code or account name in a skill,** and never tell the agent to type one. Tell it to ask the person.
- **Say what is destructive** (overwrites, sends, plays audio, deletes) and what to check before it.
- **Name the fallback and when to stop.** If the first route fails twice, say which route is next, and when to ask the person.
- **No claims you cannot check.** If you could not read a source, say so in the skill.
- **Your own words.** No copied vendor documentation; link to it. Facts (a shortcut, a class name) are fine. Use an app's name only to name the app.
- **Nothing private.** No machine names, user names, paths, or internal systems of your own. This repository is public.

## Versions

- One skill per app, never a copy per app version. `SKILL.md` holds what is true for every version; a line that differs starts with a range tag, `[v >=21]`, `[v <21]` or `[v >=20.1 <21]`; an untagged line is true everywhere. Use `≈` when you saw it on one version and do not know how far back it goes.
- Check that a call, property or menu item exists before relying on the version number, and say so in the skill.
- Every saved change bumps `version` and adds a `changelog` entry; CI refuses a changed skill whose version did not go up.
- A newer app than any tested one still gets the skill, with the warning "untested: verify every step".

## Drafting from a session

When you explore an app for the skill: record each action you took and what you saw after it (the `Desktop` audit log keeps the actions). Put into the skill only the actions whose result you confirmed. A person reviews the skill before it is saved.

## Proof

Run `test.json` with the person's grant on a machine that has the app, then add a record to `verification/<folder>/<version>.json`: `{ skillVersion, appVersion, platform, date, runner, result, notes, evidenceSha256 }`. `runner` is `AgentMux test machine` or `community:<your GitHub handle>`, never a host or user name; the evidence is a SHA-256, never a screenshot. "Verified on Live 12.1" means exactly that: the test passed on 12.1 at that skill version.
