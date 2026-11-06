// Copyright 2026, AgentMux Corp.
// SPDX-License-Identifier: Apache-2.0

/**
 * What the catalog checks about a computer-use skill, and how it is hashed and
 * signed. No dependencies; Node's own crypto.
 *
 * The signature scheme is the widget catalog's (AgentMux SPEC_WIDGET_SHARING §2)
 * with its own domain tag, so a skill's signature can't pass as a widget's:
 *   - content hash: each file's SHA-256, then SHA-256 over "path\0hash\n" in
 *     byte order of the path, leaving out skill.sig and verified.json;
 *   - signature: Ed25519 over "agentmux-skill-sig-v1\0<id>\0<version>\0<hash>",
 *     where <id> is "<publisher>.<id>".
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SIG_FILE = "skill.sig";
export const MANIFEST = "computer-use.json";
export const EXCLUDED = new Set([SIG_FILE, "verified.json"]);
export const CONTEXT = "agentmux-skill-sig-v1\0";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const TEXT_EXT = new Set([".md", ".json", ".txt", ".py", ".ps1", ".js", ".mjs", ".vbs", ".jsx", ".bat", ".sh"]);
const SCRIPT_EXT = new Set([".py", ".ps1", ".js", ".mjs", ".vbs", ".jsx", ".bat", ".sh"]);
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const KINDS = new Set(["api", "mcp", "shortcuts", "desktop"]);
const PLATFORMS = new Set(["windows", "macos", "linux"]);

// ── Reading a skill folder ─────────────────────────────────────────────────

/** relative path → bytes, every file in `dir`, with the catalog's limits applied. */
export function readSkill(dir) {
    const files = new Map();
    let total = 0;
    const walk = (abs, rel) => {
        for (const name of readdirSync(abs).sort()) {
            const p = join(abs, name);
            const r = rel ? `${rel}/${name}` : name;
            const st = lstatSync(p);
            if (st.isSymbolicLink()) throw new Error(`${r} is a link; a skill can't contain links`);
            if (st.isDirectory()) {
                walk(p, r);
                continue;
            }
            if (st.size > MAX_FILE_BYTES) throw new Error(`${r} is over 1 MB`);
            const bytes = readFileSync(p);
            total += bytes.length;
            if (total > MAX_TOTAL_BYTES) throw new Error("the skill is over 5 MB");
            files.set(r, bytes);
            if (files.size > MAX_FILES) throw new Error(`the skill has over ${MAX_FILES} files`);
        }
    };
    walk(dir, "");
    return files;
}

/** The content hash of `files` (a Map from readSkill). */
export function contentHash(files) {
    const h = createHash("sha256");
    const paths = [...files.keys()].filter((p) => !EXCLUDED.has(p));
    for (const path of paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
        h.update(path).update("\0").update(createHash("sha256").update(files.get(path)).digest("hex")).update("\n");
    }
    return h.digest("hex");
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ── Keys and signatures ────────────────────────────────────────────────────

export function keyFromSeed(seedB64) {
    const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedB64, "base64")]), format: "der", type: "pkcs8" });
    const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length).toString("base64");
    return { privateKey, publicKey };
}

export function newKey() {
    const { privateKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(PKCS8_PREFIX.length).toString("base64");
    return { seed, publicKey: keyFromSeed(seed).publicKey };
}

export function publicKeyOf(b64) {
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(b64, "base64")]), format: "der", type: "spki" });
}

export const signedMessage = (catalogId, version, hash) => Buffer.from(`${CONTEXT}${catalogId}\0${version}\0${hash}`);

/** `K7Q2-MZ4D-PX3A-9TWE`: the first 10 bytes of the key's SHA-256, base32 (the widget catalog's form). */
export function fingerprint(publicKeyB64) {
    const digest = createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest().subarray(0, 10);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let buf = 0;
    let text = "";
    for (const b of digest) {
        buf = (buf << 8) | b;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            text += alphabet[(buf >> bits) & 31];
        }
    }
    if (bits > 0) text += alphabet[(buf << (5 - bits)) & 31];
    return text.match(/.{1,4}/g).join("-");
}

/** The text of skill.sig for `files`, signed with the seed. */
export function signFiles(files, seedB64) {
    const m = JSON.parse(files.get(MANIFEST).toString("utf8"));
    const { privateKey, publicKey } = keyFromSeed(seedB64);
    const signature = sign(null, signedMessage(`${m.publisher}.${m.id}`, m.version, contentHash(files)), privateKey).toString("base64");
    return JSON.stringify({ sigVersion: 1, algorithm: "ed25519", publicKey, signature }, null, 2) + "\n";
}

// ── The checks ─────────────────────────────────────────────────────────────

/**
 * Name and description from SKILL.md's frontmatter (the flat keys the spec allows). The values must be valid YAML for
 * any Agent Skills reader: a double-quoted value is read as JSON (its escapes are YAML's), a single-quoted one with ''
 * for an apostrophe, and a plain one may not contain ": " or " #" or start with a YAML indicator character, which a
 * strict parser rejects or reads differently. Quote a description that has a colon in it.
 */
export function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (!m) throw new Error("SKILL.md needs YAML frontmatter");
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
        if (!kv) continue;
        const [, key, raw] = kv;
        const v = raw.trim();
        if (v.startsWith('"')) {
            try {
                out[key] = JSON.parse(v);
            } catch {
                throw new Error(`SKILL.md ${key}: a double-quoted value must be one valid string (escape " as \\")`);
            }
        } else if (v.startsWith("'")) {
            if (v.length < 2 || !v.endsWith("'") || /(^|[^'])'([^']|$)/.test(v.slice(1, -1))) {
                throw new Error(`SKILL.md ${key}: a single-quoted value must end with ' and double any ' inside it`);
            }
            out[key] = v.slice(1, -1).replace(/''/g, "'");
        } else {
            if (/: |\s#/.test(v) || /^[[\]{}&*!|>%@`,?-]/.test(v)) {
                throw new Error(`SKILL.md ${key}: a plain value can't contain ": " or " #" or start with an indicator character; wrap it in double quotes`);
            }
            out[key] = v;
        }
    }
    return out;
}

const SECRET_PATTERNS = [
    ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
    ["token", /\b(?:ghp_|gho_|github_pat_|xox[bpa]-|sk-[A-Za-z0-9]{20,})[A-Za-z0-9_-]{10,}/],
    ["literal-secret", /\b(?:password|passwd|passphrase|api[_ -]?key|secret)\b\s*[:=]\s*["'][^"'\s]{4,}["']/i],
];
const CREDENTIAL_READS = [
    ["credential-store", /\b(?:cmdkey|vaultcmd|Get-StoredCredential|CredentialManager|find-generic-password|find-internet-password|secret-tool)\b/i],
    ["browser-profile", /\b(?:Login Data|Cookies\.sqlite|logins\.json|key4\.db)\b/],
    ["secret-files", /(?:\.aws[\\/]credentials|\.ssh[\\/]id_|\.netrc\b|(?:^|[\\/\s"'])\.env\b)/],
];
const TYPED_SECRET = /\b(?:type|types|typing|enter|send ?keys?|fill)\b[^\n.]{0,60}\b(?:password|passwd|passphrase|token|api key|licen[cs]e (?:code|key)|serial number)\b/i;
// A line that forbids typing a secret, or sends the agent to the person, is the guidance we want.
const SAFE_LINE = /\b(?:never|don't|do not|must not|mustn't|not to|ask the person|refuse)\b/i;
const NETWORK =/\b(?:https?:\/\/|Invoke-WebRequest|Invoke-RestMethod|curl|wget|requests\.|urllib|fetch\(|WebClient|socket\.)/i;
const VENDOR_TEXT = /(?:©|\ball rights reserved\b|\bcopyright \(c\))/i;

/**
 * Checks one skill folder. Returns `{ manifest, files, hash, signed, fingerprint,
 * publicKey, notes }` or throws with the first rule it breaks. `overrides` is the
 * list from .github/scan-overrides.json: `{ skill, id, file }`, reviewed in the pull request.
 */
export function checkSkill(dir, folder, { publishers, overrides = [] }) {
    const files = readSkill(dir);
    const notes = [];
    const text = (name) => files.get(name)?.toString("utf8");

    if (!NAME.test(folder) || folder.length > 64) throw new Error("the folder name must be lowercase letters, digits and single hyphens, at most 64 characters");
    for (const path of files.keys()) {
        const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
        if (!TEXT_EXT.has(ext) && path !== SIG_FILE) throw new Error(`${path}: only text and script files are accepted (${[...TEXT_EXT].join(" ")})`);
    }

    // SKILL.md
    const skillMd = text("SKILL.md");
    if (skillMd == null) throw new Error("no SKILL.md");
    const fm = frontmatter(skillMd);
    if (fm.name !== folder) throw new Error(`SKILL.md name (${fm.name}) must match the folder (${folder})`);
    if (!fm.description || fm.description.length > 1024) throw new Error("SKILL.md needs a description of 1 to 1024 characters");
    if (skillMd.split("\n").length > 500) throw new Error("SKILL.md is over 500 lines: move detail into reference files");

    // The manifest
    const raw = text(MANIFEST);
    if (raw == null) throw new Error(`no ${MANIFEST}`);
    const m = JSON.parse(raw);
    if (m.schema !== "computer-use-skill/v1") throw new Error(`${MANIFEST}: schema must be computer-use-skill/v1`);
    if (!NAME.test(m.publisher ?? "") || !NAME.test(m.id ?? "")) throw new Error(`${MANIFEST}: publisher and id must be lowercase letters, digits and hyphens`);
    if (`${m.publisher}-${m.id}` !== folder) throw new Error(`the folder must be ${m.publisher}-${m.id}`);
    if (typeof m.name !== "string" || !m.name.trim()) throw new Error(`${MANIFEST}: needs a name`);
    if (!SEMVER.test(m.version ?? "")) throw new Error(`${MANIFEST}: version must be semver`);
    if (!Array.isArray(m.changelog) || !m.changelog.length || m.changelog.at(-1)?.version !== m.version) {
        throw new Error(`${MANIFEST}: changelog must end with an entry for version ${m.version}`);
    }
    if (typeof m.app?.vendor !== "string" || typeof m.app?.executables !== "object") throw new Error(`${MANIFEST}: app.vendor and app.executables are required`);
    if (!Array.isArray(m.platforms) || !m.platforms.length || m.platforms.some((p) => !PLATFORMS.has(p))) throw new Error(`${MANIFEST}: platforms must list windows, macos or linux`);
    if (!Array.isArray(m.ladder) || !m.ladder.length || m.ladder.some((r) => !KINDS.has(r.kind) || typeof r.note !== "string")) {
        throw new Error(`${MANIFEST}: ladder must list { kind: api | mcp | shortcuts | desktop, note }`);
    }
    // A catalog id, bare or as { catalogId, note } (catalogId null: no catalog entry yet). Any command or arguments, or
    // whitespace in the id, makes it a command line.
    if (m.mcp != null) {
        const object = typeof m.mcp === "object" && !Array.isArray(m.mcp);
        const id = typeof m.mcp === "string" ? m.mcp : object ? (m.mcp.catalogId ?? null) : undefined;
        const badId = id !== null && (typeof id !== "string" || !id || /\s/.test(id));
        if ((typeof m.mcp !== "string" && !object) || badId || (object && ("command" in m.mcp || "args" in m.mcp))) {
            throw new Error(`${MANIFEST}: mcp is a catalog id (a string or { catalogId, note }), never a command line`);
        }
    }

    // The test
    const t = JSON.parse(text("test.json") ?? "null");
    if (!t) throw new Error("no test.json");
    if (t.skill !== `${m.publisher}.${m.id}`) throw new Error(`test.json: skill must be ${m.publisher}.${m.id}`);
    if (typeof t.task !== "string" || !Array.isArray(t.steps) || !Array.isArray(t.verify) || !t.verify.length) {
        throw new Error("test.json needs a task, steps, and at least one verify cue");
    }

    // Scripts: every script file is listed with its hash; a network script says so.
    const listed = new Map((m.scripts ?? []).map((s) => [s.path, s]));
    for (const [path, bytes] of files) {
        const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
        if (!SCRIPT_EXT.has(ext)) continue;
        const s = listed.get(path);
        if (!s) throw new Error(`${path} is a script: list it in ${MANIFEST} "scripts" with its sha256, purpose and needs`);
        if (s.sha256 !== sha256(bytes)) throw new Error(`${path}: sha256 in ${MANIFEST} doesn't match the file (run: node scripts/skill-sign.mjs hashes ${dir})`);
        if (!["test", "helper"].includes(s.purpose) || !Array.isArray(s.needs)) throw new Error(`${path}: scripts[] needs a purpose (test | helper) and a needs list`);
        if (NETWORK.test(bytes.toString("utf8")) && !s.needs.some((n) => /^network:/.test(n))) {
            throw new Error(`${path} uses the network: add "network:<origin>" to its needs`);
        }
    }
    for (const p of listed.keys()) if (!files.has(p)) throw new Error(`${MANIFEST} lists ${p}, which isn't in the folder`);

    // Secrets, credential reads, typed passwords, copied vendor text.
    const flagged = (id, file) => overrides.some((o) => o.skill === folder && o.id === id && o.file === file);
    for (const [path, bytes] of files) {
        if (path === SIG_FILE) continue;
        const body = bytes.toString("utf8");
        for (const [id, re] of [...SECRET_PATTERNS, ...CREDENTIAL_READS]) {
            if (re.test(body) && !flagged(id, path)) throw new Error(`${path}: ${id} (a reviewer can clear a false positive in .github/scan-overrides.json)`);
        }
        const typesSecret = body.split("\n").some((line) => TYPED_SECRET.test(line) && !SAFE_LINE.test(line));
        if (typesSecret && !flagged("typed-secret", path)) {
            throw new Error(`${path}: it tells an agent to type a password, token or licence code; tell it to ask the person instead`);
        }
        if (VENDOR_TEXT.test(body) && !flagged("vendor-text", path)) throw new Error(`${path}: a copyright notice or "all rights reserved" suggests copied text; use your own words`);
    }

    // The signature
    const hash = contentHash(files);
    const sigText = text(SIG_FILE);
    let signed = false;
    let fp = "";
    let publicKey = null;
    if (sigText != null) {
        const sig = JSON.parse(sigText);
        if (sig.sigVersion !== 1 || sig.algorithm !== "ed25519") throw new Error(`${SIG_FILE} isn't a version 1 ed25519 signature`);
        if (!publishers[m.publisher]) throw new Error(`publisher ${m.publisher} isn't in publishers.json: add your key there in this PR`);
        if (publishers[m.publisher] !== sig.publicKey) throw new Error(`signed by another key than the one publishers.json lists for ${m.publisher}`);
        const ok = verify(null, signedMessage(`${m.publisher}.${m.id}`, m.version, hash), publicKeyOf(sig.publicKey), Buffer.from(sig.signature, "base64"));
        if (!ok) throw new Error("its signature doesn't match its files: sign it again after the last edit");
        signed = true;
        publicKey = sig.publicKey;
        fp = fingerprint(sig.publicKey);
    } else if (m.publisher === "agentmux") {
        notes.push("not signed yet: the release workflow signs it; it is left out of the index until then");
    } else {
        throw new Error(`not signed: every community skill must be signed with the key listed for ${m.publisher} in publishers.json (node scripts/skill-sign.mjs sign <folder> --key <key file>)`);
    }
    return { manifest: m, description: fm.description, files, hash, signed, fingerprint: fp, publicKey, notes };
}

/** Checks the pass records in verification/<folder>/*.json and returns the public summary. */
export function checkVerification(records, folder) {
    if (!Array.isArray(records)) throw new Error(`verification/${folder}: each file is a list of records`);
    return records.map((r, i) => {
        for (const k of ["skillVersion", "appVersion", "platform", "date", "runner", "result"]) {
            if (typeof r[k] !== "string" || !r[k]) throw new Error(`verification/${folder}[${i}]: ${k} is required`);
        }
        if (!SEMVER.test(r.skillVersion) || !PLATFORMS.has(r.platform) || !["pass", "fail"].includes(r.result)) {
            throw new Error(`verification/${folder}[${i}]: skillVersion must be semver, platform windows|macos|linux, result pass|fail`);
        }
        if (!/^(AgentMux test machine|community:[A-Za-z0-9-]+)$/.test(r.runner)) {
            throw new Error(`verification/${folder}[${i}]: runner must be "AgentMux test machine" or "community:<github handle>", never a host or user name`);
        }
        if (r.evidenceSha256 != null && !/^[0-9a-f]{64}$/.test(r.evidenceSha256)) throw new Error(`verification/${folder}[${i}]: evidenceSha256 must be hex SHA-256`);
        return { skillVersion: r.skillVersion, appVersion: r.appVersion, platform: r.platform, date: r.date, result: r.result };
    });
}

// ── A small, deterministic zip writer (stored entries) ─────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** A zip of `files` (name → bytes) under `root/`, in name order, fixed times. */
export function zip(root, files) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const name of [...files.keys()].sort()) {
        const data = files.get(name);
        const path = Buffer.from(`${root}/${name}`, "utf8");
        const crc = crc32(data);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(0x0800, 6);
        head.writeUInt16LE(0, 8);
        head.writeUInt16LE(0, 10);
        head.writeUInt16LE(0x21, 12);
        head.writeUInt32LE(crc, 14);
        head.writeUInt32LE(data.length, 18);
        head.writeUInt32LE(data.length, 22);
        head.writeUInt16LE(path.length, 26);
        head.writeUInt16LE(0, 28);
        local.push(head, path, data);
        const dirEntry = Buffer.alloc(46);
        dirEntry.writeUInt32LE(0x02014b50, 0);
        dirEntry.writeUInt16LE(20, 4);
        dirEntry.writeUInt16LE(20, 6);
        dirEntry.writeUInt16LE(0x0800, 8);
        dirEntry.writeUInt16LE(0, 10);
        dirEntry.writeUInt16LE(0, 12);
        dirEntry.writeUInt16LE(0x21, 14);
        dirEntry.writeUInt32LE(crc, 16);
        dirEntry.writeUInt32LE(data.length, 20);
        dirEntry.writeUInt32LE(data.length, 24);
        dirEntry.writeUInt16LE(path.length, 28);
        dirEntry.writeUInt32LE(offset, 42);
        central.push(dirEntry, path);
        offset += head.length + path.length + data.length;
    }
    const centralBytes = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.size, 8);
    end.writeUInt16LE(files.size, 10);
    end.writeUInt32LE(centralBytes.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, centralBytes, end]);
}
