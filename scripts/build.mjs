#!/usr/bin/env node
// Copyright 2026, AgentMux Corp.
// SPDX-License-Identifier: Apache-2.0

/**
 * Checks every computer-use skill under skills/, then writes dist/index.json,
 * one zip per signed skill version, and (with CATALOG_SIGNING_SEED, on main)
 * dist/index.json.sig.
 *
 *   node scripts/build.mjs [--out dist] [--base-url https://agentmuxai.github.io/skills]
 *                          [--base-ref origin/main]
 *
 * With --base-ref, a skill whose files changed against that ref must have a
 * higher version. AgentMux checks again when it installs a skill: this is the
 * catalog's own gate, not the last one.
 *
 * A skill with no skill.sig from the `agentmux` publisher passes the check but
 * is left out of the index until the release workflow signs it; a community skill with
 * no signature fails.
 */

import { createHash, createPrivateKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkSkill, checkVerification, contentHash, zip } from "./lib.mjs";

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("--out", "dist");
const BASE_URL = arg("--base-url", "https://agentmuxai.github.io/skills").replace(/\/$/, "");
const BASE_REF = arg("--base-ref", "");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const cmp = (a, b) => {
    const pa = a.split(/[-+]/)[0].split(".").map(Number);
    const pb = b.split(/[-+]/)[0].split(".").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
};

/**
 * The skill's version and content hash at BASE_REF, or null when there is no base to compare with (no --base-ref) or the
 * skill is new there. Any other failure (a bad ref, a git error, a manifest at the base that does not parse) throws, so the
 * "changed files must raise the version" gate fails the build instead of passing without having looked.
 */
function atBase(folder) {
    if (!BASE_REF) return null;
    let list;
    try {
        list = execFileSync("git", ["ls-tree", "-r", "--name-only", BASE_REF, `skills/${folder}/`], { encoding: "utf8" }).split("\n").filter(Boolean);
    } catch (e) {
        throw new Error(`cannot read ${BASE_REF} to compare versions: ${e.message.split("\n")[0]}`);
    }
    if (!list.length) return null;
    const files = new Map();
    for (const p of list) {
        files.set(p.slice(`skills/${folder}/`.length), execFileSync("git", ["show", `${BASE_REF}:${p}`], { maxBuffer: 16 * 1024 * 1024 }));
    }
    const manifest = files.get("computer-use.json");
    if (!manifest) throw new Error(`${BASE_REF} has skills/${folder}/ without a computer-use.json, so its version can't be compared`);
    let version;
    try {
        version = JSON.parse(manifest.toString("utf8")).version;
    } catch (e) {
        throw new Error(`computer-use.json at ${BASE_REF} does not parse: ${e.message}`);
    }
    return { version, hash: contentHash(files) };
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const publishers = readJson("publishers.json", {});
const overrides = readJson(join(".github", "scan-overrides.json"), []);
const errors = [];
const entries = [];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const folder of readdirSync("skills").sort()) {
    const dir = join("skills", folder);
    if (!lstatSync(dir).isDirectory()) continue;
    try {
        const r = checkSkill(dir, folder, { publishers, overrides });
        const m = r.manifest;
        const base = atBase(folder);
        if (base && base.hash !== r.hash && cmp(m.version, base.version) <= 0) {
            throw new Error(`its files changed but the version (${m.version}) didn't go above ${base.version}: bump version and add a changelog entry`);
        }
        const vdir = join("verification", folder);
        const records = existsSync(vdir)
            ? readdirSync(vdir).filter((f) => f.endsWith(".json")).flatMap((f) => checkVerification(JSON.parse(readFileSync(join(vdir, f), "utf8")), folder))
            : [];
        for (const note of r.notes) console.log(`note ${folder}: ${note}`);
        if (!r.signed) {
            console.log(`ok   ${m.publisher}.${m.id} ${m.version} (not listed: unsigned)`);
            continue;
        }
        const zipName = `${folder}-${m.version}.zip`;
        const bytes = zip(folder, r.files);
        writeFileSync(join(OUT, zipName), bytes);
        entries.push({
            id: `${m.publisher}.${m.id}`,
            name: m.name,
            version: m.version,
            description: r.description,
            publisher: m.publisher,
            app: { vendor: m.app.vendor, executables: m.app.executables, versions: m.app.versions ?? { supported: null, tested: [] } },
            platforms: m.platforms,
            routes: m.ladder.map((l) => l.kind),
            hasScripts: (m.scripts ?? []).some((s) => s.purpose === "helper"),
            mcp: m.mcp?.catalogId ?? null,
            hash: r.hash,
            publisherKey: r.publicKey,
            fingerprint: r.fingerprint,
            verification: records,
            zip: `${BASE_URL}/${zipName}`,
            zipSha256: createHash("sha256").update(bytes).digest("hex"),
        });
        console.log(`ok   ${m.publisher}.${m.id} ${m.version}`);
    } catch (e) {
        errors.push(`${folder}: ${e instanceof Error ? e.message : String(e)}`);
    }
}
if (errors.length) {
    for (const e of errors) console.error(`FAIL ${e}`);
    process.exit(1);
}
const index = Buffer.from(JSON.stringify({ catalogVersion: 1, generated: new Date().toISOString(), skills: entries }, null, 2) + "\n");
writeFileSync(join(OUT, "index.json"), index);
const seed = process.env.CATALOG_SIGNING_SEED;
if (seed) {
    const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, "base64")]), format: "der", type: "pkcs8" });
    writeFileSync(join(OUT, "index.json.sig"), sign(null, index, key).toString("base64") + "\n");
    console.log("signed index.json");
}
console.log(`${entries.length} skill(s) in the catalog`);
