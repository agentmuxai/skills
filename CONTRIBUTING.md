# Contributing

Thank you for sharing what you know about an app. Please read this before you open a pull request.

## Licence and sign-off

Everything here is **Apache-2.0**: text and scripts. By contributing you agree your work is under that licence. There is no CLA; instead every commit carries a **Developer Certificate of Origin** sign-off, which says you wrote it or have the right to share it ([developercertificate.org](https://developercertificate.org/)):

```bash
git commit -s -m "Add acme-word"
```

CI fails a pull request with a commit that has no `Signed-off-by: Name <email>` line.

## What a skill must be

- **A standard Agent Skill folder** named `<publisher>-<id>`, with a `SKILL.md` whose `name` equals the folder name. Keep `SKILL.md` under 500 lines.
- **Signed.** Every listed skill is signed with the key `publishers.json` lists for its publisher. Sign as the last step; any edit afterwards breaks the signature.
- **Versioned.** A change to a skill's files must raise `version` in `computer-use.json` and add a `changelog` entry.
- **Honest.** Only steps you saw succeed are stated as fact. Anything from documentation says so. See the guide in `guide/write-a-skill/`.

## Content rules

- **Your own words.** No copied vendor documentation, manuals, help pages or release notes. Link to them. Facts (a shortcut, a class name, an API call) are fine.
- **Names.** Use an app's name only to name the app. No vendor logos, icons or screenshots of vendor UI, and nothing that suggests the vendor endorses the skill. Only text and script files are accepted.
- **Nothing private.** No machine names, user names, home-directory paths, account names, internal hostnames or logs. This repository is public.
- **No secrets, and no typing them.** Never include a password, key or licence code, and never tell an agent to type one: tell it to ask the person. CI flags secrets, reads of credential stores (`cmdkey`, the Keychain, browser profiles, `.env`, `~/.aws`) and instructions to type a password or token.
- **Scripts are rare and reviewed.** A script must be listed in `computer-use.json` with its `sha256`, a `purpose` (`test` or `helper`) and what it `needs`; one that uses the network says `network:<origin>`. Any change under a skill's scripts gets extra scrutiny in review, and the person who installs the skill approves each script before it can run. A script may call an app's own scripting interface; it may not bundle the app, a vendor SDK or a binary.
- **An MCP server is a pointer.** Name its catalog id in `mcp`; never a command line. The person installs and approves it in AgentMux.
- **Check the app's terms.** Do not add a skill for an app whose terms forbid automation.

## Verification records

CI cannot run Word or Live. A pass is recorded in `verification/<folder>/<version>.json` by someone who ran the skill's `test.json` on a machine that has the app. Fields: `skillVersion`, `appVersion`, `platform` (`windows`, `macos` or `linux`), `date`, `runner`, `result` (`pass` or `fail`), `notes`, and `evidenceSha256` (the SHA-256 of the output file or screenshot, never the file itself). `runner` is `AgentMux test machine` or `community:<your GitHub handle>`. A record is reviewed in the pull request; you cannot certify your own skill.

## False positives

If a scan flags something that is fine (for example a skill that explains what *not* to do), say so in the pull request. The reviewer can clear one flag for one file in `.github/scan-overrides.json`: `{ "skill": "acme-word", "id": "credential-store", "file": "SKILL.md" }`.

## Reporting a problem

Open an issue in this repository. For a security problem, use GitHub's private vulnerability reporting for this repository rather than a public issue.
