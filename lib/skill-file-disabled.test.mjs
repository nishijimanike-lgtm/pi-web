import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  FILE_DISABLED_NAME,
  SKILL_FILE_NAME,
  isFileDisabledPath,
  scanFileDisabledSkills,
  toEnabledSkillPath,
} from "./skill-file-disabled.ts";

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "pi-web-file-disabled-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const skillBody = (name) =>
  `---\nname: ${name}\ndescription: Does ${name} things\n---\n\nBody.\n`;

describe("isFileDisabledPath", () => {
  it("recognizes the .disabled rename and nothing else", () => {
    assert.equal(isFileDisabledPath("/a/b/SKILL.md.disabled"), true);
    assert.equal(isFileDisabledPath("/a/b/SKILL.md"), false);
    assert.equal(isFileDisabledPath("/a/b/README.md.disabled"), false);
    assert.equal(isFileDisabledPath("/a/b/AGENTS.md"), false);
  });
});

describe("toEnabledSkillPath", () => {
  it("maps SKILL.md.disabled back to SKILL.md in the same directory", () => {
    assert.equal(
      toEnabledSkillPath("/a/b/SKILL.md.disabled"),
      join("/a", "b", SKILL_FILE_NAME),
    );
  });
});

describe("scanFileDisabledSkills", () => {
  it("finds SKILL.md.disabled and parses name/description from frontmatter", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "alpha"));
      writeFileSync(join(root, "alpha", FILE_DISABLED_NAME), skillBody("alpha"));
      const found = scanFileDisabledSkills([{ root, scope: "user" }]);
      assert.equal(found.length, 1);
      assert.equal(found[0].name, "alpha");
      assert.equal(found[0].description, "Does alpha things");
      assert.equal(found[0].filePath, join(root, "alpha", FILE_DISABLED_NAME));
      assert.equal(found[0].scope, "user");
    } finally {
      cleanup();
    }
  });

  it("falls back to the parent directory name when frontmatter has no name", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "beta"));
      writeFileSync(
        join(root, "beta", FILE_DISABLED_NAME),
        "---\ndescription: Beta things\n---\n\nBody.\n",
      );
      const found = scanFileDisabledSkills([{ root, scope: "user" }]);
      assert.equal(found.length, 1);
      assert.equal(found[0].name, "beta");
    } finally {
      cleanup();
    }
  });

  it("ignores SKILL.md.disabled when a SKILL.md sits in the same directory", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "gamma"));
      writeFileSync(join(root, "gamma", FILE_DISABLED_NAME), skillBody("gamma"));
      writeFileSync(join(root, "gamma", SKILL_FILE_NAME), skillBody("gamma"));
      const found = scanFileDisabledSkills([{ root, scope: "user" }]);
      assert.equal(found.length, 0);
    } finally {
      cleanup();
    }
  });

  it("treats a dir with SKILL.md.disabled as a skill root and does not recurse deeper", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "delta", "nested"), { recursive: true });
      writeFileSync(join(root, "delta", FILE_DISABLED_NAME), skillBody("delta"));
      writeFileSync(
        join(root, "delta", "nested", FILE_DISABLED_NAME),
        skillBody("nested"),
      );
      const found = scanFileDisabledSkills([{ root, scope: "user" }]);
      assert.deepEqual(
        found.map((s) => s.name),
        ["delta"],
      );
    } finally {
      cleanup();
    }
  });

  it("skips hidden directories, node_modules, and files without a description", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, ".hidden"));
      writeFileSync(join(root, ".hidden", FILE_DISABLED_NAME), skillBody("hidden"));
      mkdirSync(join(root, "node_modules"));
      writeFileSync(join(root, "node_modules", FILE_DISABLED_NAME), skillBody("dep"));
      mkdirSync(join(root, "epsilon"));
      writeFileSync(join(root, "epsilon", FILE_DISABLED_NAME), "---\n---\nNo description here.\n");
      const found = scanFileDisabledSkills([{ root, scope: "user" }]);
      assert.equal(found.length, 0);
    } finally {
      cleanup();
    }
  });

  it("deduplicates the same physical file reached through two roots", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "zeta"));
      writeFileSync(join(root, "zeta", FILE_DISABLED_NAME), skillBody("zeta"));
      const found = scanFileDisabledSkills([
        { root, scope: "user" },
        { root, scope: "project" }, // same root twice
      ]);
      assert.equal(found.length, 1);
      assert.equal(found[0].scope, "user");
    } finally {
      cleanup();
    }
  });

  it("assigns scope per root", () => {
    const { root, cleanup } = makeTree();
    try {
      mkdirSync(join(root, "user-skill"));
      writeFileSync(join(root, "user-skill", FILE_DISABLED_NAME), skillBody("user-skill"));
      mkdirSync(join(root, "project-skill"));
      writeFileSync(join(root, "project-skill", FILE_DISABLED_NAME), skillBody("project-skill"));
      const found = scanFileDisabledSkills([
        { root: join(root, "user-skill"), scope: "user" },
        { root: join(root, "project-skill"), scope: "project" },
      ]);
      const byName = Object.fromEntries(found.map((s) => [s.name, s.scope]));
      assert.equal(byName["user-skill"], "user");
      assert.equal(byName["project-skill"], "project");
    } finally {
      cleanup();
    }
  });

  it("returns nothing for missing roots", () => {
    assert.deepEqual(
      scanFileDisabledSkills([{ root: "/definitely/not/here", scope: "user" }]),
      [],
    );
  });
});
