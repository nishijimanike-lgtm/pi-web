import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { expandInlineSkills, extractSlashQuery } =
  await jiti.import("./skill-inline.ts");

const availableSkills = [
  {
    name: "docx",
    filePath: "/Users/test/.agents/skills/docx/SKILL.md",
    content: "# Docx Skill\nInstructions for docx.",
  },
  {
    name: "pdf",
    filePath: "/Users/test/.agents/skills/pdf/SKILL.md",
    content: "# PDF Skill\nInstructions for pdf.",
  },
  {
    name: "lint-code",
    filePath: "/Users/test/.agents/skills/lint-code/SKILL.md",
    content: "# Lint Skill\nInstructions for lint.",
  },
];

test("extractSlashQuery detects slash and backslash at start or after whitespace", () => {
  // At start
  assert.deepEqual(extractSlashQuery("/"), {
    start: 0,
    query: "",
    prefixChar: "/",
  });
  assert.deepEqual(extractSlashQuery("/doc"), {
    start: 0,
    query: "doc",
    prefixChar: "/",
  });
  assert.deepEqual(extractSlashQuery("\\"), {
    start: 0,
    query: "",
    prefixChar: "\\",
  });
  assert.deepEqual(extractSlashQuery("\\doc"), {
    start: 0,
    query: "doc",
    prefixChar: "\\",
  });

  // Inline after whitespace
  assert.deepEqual(extractSlashQuery("hello \\doc"), {
    start: 6,
    query: "doc",
    prefixChar: "\\",
  });
  assert.deepEqual(extractSlashQuery("请用 /pdf"), {
    start: 3,
    query: "pdf",
    prefixChar: "/",
  });

  // Windows path should not trigger
  assert.equal(extractSlashQuery("C:\\Users\\test"), null);
  assert.equal(extractSlashQuery("D:\\github\\file.ts"), null);
});

test("expandInlineSkills expands multiple skills anywhere in prompt text", () => {
  const input = "请帮我用 \\docx 写一份文档，并用 \\pdf 导出";
  const result = expandInlineSkills(input, availableSkills);

  assert.ok(
    result.includes(
      '<skill name="docx" location="/Users/test/.agents/skills/docx/SKILL.md">',
    ),
  );
  assert.ok(
    result.includes(
      '<skill name="pdf" location="/Users/test/.agents/skills/pdf/SKILL.md">',
    ),
  );
  assert.ok(result.endsWith("请帮我用 \\docx 写一份文档，并用 \\pdf 导出"));
});

test("expandInlineSkills supports /skill:name and /name formats", () => {
  const input = "请检查 /skill:lint-code 的输出";
  const result = expandInlineSkills(input, availableSkills);

  assert.ok(result.includes('<skill name="lint-code"'));
  assert.ok(result.endsWith("请检查 /skill:lint-code 的输出"));
});

test("expandInlineSkills ignores Windows file paths", () => {
  const input = "文件路径是 C:\\Users\\test\\docx\\file.txt 请不要误识别";
  const result = expandInlineSkills(input, availableSkills);

  assert.equal(result, input);
});

test("expandInlineSkills deduplicates multiple references to the same skill", () => {
  const input = "先用 \\docx 打开，然后再次用 \\docx 保存";
  const result = expandInlineSkills(input, availableSkills);

  const matches = result.match(/<skill name="docx"/g);
  assert.equal(matches?.length, 1);
});
