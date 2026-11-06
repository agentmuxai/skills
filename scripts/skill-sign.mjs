#!/usr/bin/env node
// Copyright 2026, AgentMux Corp.
// SPDX-License-Identifier: Apache-2.0

/**
 * Keys, hashes and signatures for computer-use skills. No dependencies.
 *
 *   node scripts/skill-sign.mjs keygen <key file>          make a key (keep the file private)
 *   node scripts/skill-sign.mjs hashes <skill folder>      rewrite the script hashes in computer-use.json
 *   node scripts/skill-sign.mjs sign <skill folder> --key <key file>
 *   node scripts/skill-sign.mjs verify <skill folder>      print the signer's fingerprint
 *
 * Signing is the last step: any edit after it breaks the signature.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST, SIG_FILE, contentHash, fingerprint, keyFromSeed, newKey, publicKeyOf, readSkill, sha256, signFiles, signedMessage } from "./lib.mjs";
import { verify } from "node:crypto";

const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
};

try {
    if (cmd === "keygen") {
        if (!target) throw new Error("usage: keygen <key file>");
        if (existsSync(target)) throw new Error(`${target} exists; not overwriting it`);
        const k = newKey();
        writeFileSync(target, JSON.stringify({ seed: k.seed, publicKey: k.publicKey }, null, 2) + "\n", { mode: 0o600 });
        console.log(`wrote ${target}\npublic key: ${k.publicKey}\nfingerprint: ${fingerprint(k.publicKey)}\nadd to publishers.json: "<publisher>": "${k.publicKey}"`);
    } else if (cmd === "hashes") {
        const files = readSkill(target);
        const p = join(target, MANIFEST);
        const m = JSON.parse(readFileSync(p, "utf8"));
        for (const s of m.scripts ?? []) {
            if (!files.has(s.path)) throw new Error(`${s.path} isn't in the folder`);
            s.sha256 = sha256(files.get(s.path));
        }
        writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
        console.log(`updated ${(m.scripts ?? []).length} script hash(es)`);
    } else if (cmd === "sign") {
        const keyFile = flag("--key");
        if (!target || !keyFile) throw new Error("usage: sign <skill folder> --key <key file>");
        const { seed } = JSON.parse(readFileSync(keyFile, "utf8"));
        const files = readSkill(target);
        files.delete(SIG_FILE);
        writeFileSync(join(target, SIG_FILE), signFiles(files, seed));
        console.log(`signed ${target}; fingerprint ${fingerprint(keyFromSeed(seed).publicKey)}`);
    } else if (cmd === "verify") {
        const files = readSkill(target);
        const m = JSON.parse(files.get(MANIFEST).toString("utf8"));
        const sig = JSON.parse(files.get(SIG_FILE).toString("utf8"));
        const ok = verify(null, signedMessage(`${m.publisher}.${m.id}`, m.version, contentHash(files)), publicKeyOf(sig.publicKey), Buffer.from(sig.signature, "base64"));
        if (!ok) throw new Error("its signature doesn't match its files: sign it again after the last edit");
        console.log(`ok, signed by ${fingerprint(sig.publicKey)}`);
    } else {
        throw new Error("usage: skill-sign.mjs keygen|hashes|sign|verify …");
    }
} catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
}
