// Copyright 2026, AgentMux Corp.
// SPDX-License-Identifier: Apache-2.0

// node --test scripts/
import { strict as assert } from "node:assert";
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSkill, checkVerification, contentHash, frontmatter, newKey, readSkill, sha256, signFiles, fingerprint } from "./lib.mjs";

const manifest = (over = {}) => ({
    schema: "computer-use-skill/v1",
    publisher: "acme",
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    changelog: [{ version: "1.0.0", date: "2026-11-06", by: "acme", change: "first" }],
    app: { vendor: "Acme", executables: { windows: ["demo.exe"], macos: [], linux: [] }, versions: { supported: null, tested: [] } },
    platforms: ["windows"],
    ladder: [{ kind: "api", note: "its scripting" }],
    mcp: null,
    ...over,
});
const testJson = () => ({ skill: "acme.demo", task: "do a thing", steps: ["step"], verify: ["a file exists"] });

/** A skill folder named `folder` with the given extra files. */
function make({ folder = "acme-demo", m = manifest(), skill, extra = {} } = {}) {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    const dir = join(root, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), skill ?? `---\nname: ${folder}\ndescription: Use when driving Demo.\n---\n\n# Demo\n`);
    writeFileSync(join(dir, "computer-use.json"), JSON.stringify(m));
    writeFileSync(join(dir, "test.json"), JSON.stringify(testJson()));
    for (const [name, body] of Object.entries(extra)) writeFileSync(join(dir, name), body);
    return { dir, folder };
}

const key = newKey();
const publishers = { acme: key.publicKey };
const sign = (dir) => writeFileSync(join(dir, "skill.sig"), signFiles(readSkill(dir), key.seed));

test("a signed skill passes and reports its fingerprint", () => {
    const { dir, folder } = make();
    sign(dir);
    const r = checkSkill(dir, folder, { publishers });
    assert.equal(r.signed, true);
    assert.equal(r.fingerprint, fingerprint(key.publicKey));
});

test("editing a file after signing breaks the signature", () => {
    const { dir, folder } = make();
    sign(dir);
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${folder}\ndescription: changed.\n---\n`);
    assert.throws(() => checkSkill(dir, folder, { publishers }), /signature doesn't match/);
});

test("the signature file and verified.json are not part of the hash", () => {
    const { dir } = make();
    const before = contentHash(readSkill(dir));
    sign(dir);
    writeFileSync(join(dir, "verified.json"), "[]");
    assert.equal(contentHash(readSkill(dir)), before);
});

test("a community skill with no signature fails; an agentmux one is left out of the index", () => {
    const c = make();
    assert.throws(() => checkSkill(c.dir, c.folder, { publishers }), /not signed/);
    const a = make({ folder: "agentmux-demo", m: manifest({ publisher: "agentmux" }) });
    writeFileSync(join(a.dir, "test.json"), JSON.stringify({ ...testJson(), skill: "agentmux.demo" }));
    const r = checkSkill(a.dir, a.folder, { publishers });
    assert.equal(r.signed, false);
});

test("a different key for a known publisher fails", () => {
    const { dir, folder } = make();
    sign(dir);
    assert.throws(() => checkSkill(dir, folder, { publishers: { acme: newKey().publicKey } }), /another key/);
});

test("the folder must match the SKILL.md name and publisher-id", () => {
    const a = make({ skill: "---\nname: other\ndescription: x\n---\n" });
    assert.throws(() => checkSkill(a.dir, a.folder, { publishers }), /must match the folder/);
    const b = make({ folder: "acme-wrong" });
    assert.throws(() => checkSkill(b.dir, b.folder, { publishers }), /the folder must be acme-demo/);
});

test("a script must be listed with its hash, and a network script must say so", () => {
    const body = "print('hi')\n";
    const bare = make({ extra: { "run.py": body } });
    assert.throws(() => checkSkill(bare.dir, bare.folder, { publishers }), /list it in/);
    const wrong = make({ m: manifest({ scripts: [{ path: "run.py", sha256: "0".repeat(64), purpose: "helper", needs: [] }] }), extra: { "run.py": body } });
    assert.throws(() => checkSkill(wrong.dir, wrong.folder, { publishers }), /sha256 .* doesn't match/);
    const net = "import requests\nrequests.get('https://example.com')\n";
    const n = make({ m: manifest({ scripts: [{ path: "net.py", sha256: sha256(Buffer.from(net)), purpose: "helper", needs: [] }] }), extra: { "net.py": net } });
    assert.throws(() => checkSkill(n.dir, n.folder, { publishers }), /uses the network/);
});

test("secrets, credential reads and typed passwords are flagged; the safe wording is not", () => {
    const flagged = (text) => {
        const a = make({ skill: `---\nname: acme-demo\ndescription: x\n---\n${text}\n` });
        sign(a.dir);
        return () => checkSkill(a.dir, a.folder, { publishers });
    };
    assert.throws(flagged("password = 'hunter2hunter2'"), /literal-secret/);
    assert.throws(flagged("run cmdkey /list to find it"), /credential-store/);
    assert.throws(flagged("Then type the password into the field."), /type a password/);
    assert.doesNotThrow(flagged("Never type a password; ask the person."));
});

test("a maintainer override clears one flag for one file only", () => {
    const a = make({ skill: "---\nname: acme-demo\ndescription: x\n---\nrun cmdkey /list\n" });
    sign(a.dir);
    const overrides = [{ skill: "acme-demo", id: "credential-store", file: "SKILL.md" }];
    assert.doesNotThrow(() => checkSkill(a.dir, a.folder, { publishers, overrides }));
    assert.throws(() => checkSkill(a.dir, a.folder, { publishers, overrides: [{ ...overrides[0], file: "other.md" }] }), /credential-store/);
});

test("images and other binaries are refused", () => {
    const a = make({ extra: { "shot.png": "x" } });
    assert.throws(() => checkSkill(a.dir, a.folder, { publishers }), /only text and script files/);
});

test("verification records: no host or user names, valid fields", () => {
    const ok = { skillVersion: "1.0.0", appVersion: "5.2.3", platform: "windows", date: "2026-11-06", runner: "AgentMux test machine", result: "pass" };
    assert.equal(checkVerification([ok], "x").length, 1);
    assert.throws(() => checkVerification([{ ...ok, runner: "Someone@HOST" }], "x"), /never a host or user name/);
    assert.throws(() => checkVerification([{ ...ok, platform: "beos" }], "x"), /platform/);
    assert.doesNotThrow(() => checkVerification([{ ...ok, runner: "community:octocat" }], "x"));
});

test("every checked-in skill passes the format rules", () => {
    const publishersFile = JSON.parse(readFileSync(new URL("../publishers.json", import.meta.url), "utf8"));
    const root = fileURLToPath(new URL("../skills", import.meta.url));
    const folders = readdirSync(root).filter((f) => lstatSync(join(root, f)).isDirectory());
    assert.ok(folders.length >= 5, `expected the five first skills, found ${folders.join(", ")}`);
    for (const folder of folders) {
        const r = checkSkill(join(root, folder), folder, { publishers: publishersFile });
        assert.equal(r.manifest.publisher, "agentmux");
    }
});

test("an mcp pointer is a catalog id, never a command", () => {
    const publishersFile = JSON.parse(readFileSync(new URL("../publishers.json", import.meta.url), "utf8"));
    const dir = fileURLToPath(new URL("../skills/agentmux-ableton-live", import.meta.url));
    const withMcp = (mcp) => {
        const tmp = mkdtempSync(join(tmpdir(), "skill-"));
        const copy = join(tmp, "agentmux-ableton-live");
        cpSync(dir, copy, { recursive: true });
        const file = join(copy, "computer-use.json");
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), mcp }));
        return () => checkSkill(copy, "agentmux-ableton-live", { publishers: publishersFile });
    };
    assert.doesNotThrow(withMcp({ catalogId: "ableton-live", note: "n" }));
    assert.doesNotThrow(withMcp("ableton-live"));
    assert.doesNotThrow(withMcp({ catalogId: null, note: "none in the catalog yet" }));
    for (const bad of [{ command: "uvx" }, { catalogId: "x", command: "uvx" }, { catalogId: "x", args: ["y"] }, { catalogId: "uvx ableton-mcp" }, { catalogId: 5 }, 5, ["x"]]) {
        assert.throws(withMcp(bad), /never a command line/, JSON.stringify(bad));
    }
});

test("SKILL.md frontmatter is read as strict YAML would read it", () => {
    const md = (line) => `---\nname: acme-word\n${line}\n---\nbody\n`;
    assert.equal(frontmatter(md('description: "Use when: driving Word (WINWORD.EXE), then more"')).description, "Use when: driving Word (WINWORD.EXE), then more");
    assert.equal(frontmatter(md('description: "say \\"hi\\""')).description, 'say "hi"');
    assert.equal(frontmatter(md("description: 'it''s fine: really'")).description, "it's fine: really");
    assert.equal(frontmatter(md("description: Plain text, with commas (and parentheses)")).description, "Plain text, with commas (and parentheses)");
    for (const bad of ["description: Use when: driving Word", "description: text # not a comment", "description: [a, b]", 'description: "unterminated', "description: 'unterminated", "description: - dash"]) {
        assert.throws(() => frontmatter(md(bad)), /SKILL\.md description/, bad);
    }
});
