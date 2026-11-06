const fs = require("fs");
let f = "scripts/lib.mjs", t = fs.readFileSync(f, "utf8");
function rep(a, b) { if (!t.includes(a)) throw new Error(a.slice(0, 50)); t = t.replace(a, () => b); }
rep(`/** Name and description from SKILL.md's frontmatter (the flat keys the spec allows). */
export function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (!m) throw new Error("SKILL.md needs YAML frontmatter");
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
        if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
    return out;
}`,
`/**
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
                throw new Error(\`SKILL.md \${key}: a double-quoted value must be one valid string (escape " as \\\\")\`);
            }
        } else if (v.startsWith("'")) {
            if (v.length < 2 || !v.endsWith("'") || /[^']'[^']/.test(v.slice(1, -1).replace(/''/g, ""))) {
                throw new Error(\`SKILL.md \${key}: a single-quoted value must end with ' and double any ' inside it\`);
            }
            out[key] = v.slice(1, -1).replace(/''/g, "'");
        } else {
            if (/: |\s#/.test(v) || /^[\[\]{}&*!|>%@\`,?-]/.test(v)) {
                throw new Error(\`SKILL.md \${key}: a plain value can't contain ": " or " #" or start with an indicator character; wrap it in double quotes\`);
            }
            out[key] = v;
        }
    }
    return out;
}`);
fs.writeFileSync(f, t);

// quote the descriptions
for (const p of ["skills/agentmux-ableton-live", "skills/agentmux-blender", "skills/agentmux-excel", "skills/agentmux-wavelab", "skills/agentmux-word", "guide/write-a-skill"]) {
    const file = p + "/SKILL.md";
    let s = fs.readFileSync(file, "utf8");
    s = s.replace(/^description: (.*)$/m, (_, d) => (d.startsWith('"') ? _ : "description: " + JSON.stringify(d)));
    fs.writeFileSync(file, s);
}
f = "skills/agentmux-blender/SKILL.md"; t = fs.readFileSync(f, "utf8");
rep("Blender 5.2.3 LTS on 2026-11-05 and passed", "Blender 5.2.3 LTS on 2026-11-06 and passed");
fs.writeFileSync(f, t);

f = "scripts/lib.test.mjs"; t = fs.readFileSync(f, "utf8");
t += `
test("SKILL.md frontmatter is read as strict YAML would read it", () => {
    const md = (line) => \`---\nname: acme-word\n\${line}\n---\nbody\n\`;
    assert.equal(frontmatter(md('description: "Use when: driving Word (WINWORD.EXE), then more"')).description, "Use when: driving Word (WINWORD.EXE), then more");
    assert.equal(frontmatter(md('description: "say \\\\"hi\\\\""')).description, 'say "hi"');
    assert.equal(frontmatter(md("description: 'it''s fine: really'")).description, "it's fine: really");
    assert.equal(frontmatter(md("description: Plain text, with commas (and parentheses)")).description, "Plain text, with commas (and parentheses)");
    for (const bad of ["description: Use when: driving Word", "description: text # not a comment", "description: [a, b]", 'description: "unterminated', "description: 'unterminated", "description: - dash"]) {
        assert.throws(() => frontmatter(md(bad)), /SKILL\.md description/, bad);
    }
});
`;
t = t.replace("import { checkSkill, checkVerification, contentHash, newKey, readSkill, sha256, signFiles, fingerprint } from \"./lib.mjs\";", "import { checkSkill, checkVerification, contentHash, frontmatter, newKey, readSkill, sha256, signFiles, fingerprint } from \"./lib.mjs\";");
fs.writeFileSync(f, t);
