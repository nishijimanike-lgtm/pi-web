import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * skill-hub 类生态工具的禁用方式是物理重命名 SKILL.md -> SKILL.md.disabled，
 * 而 pi-web 使用 frontmatter 软标记 (disable-model-invocation)。pi 的
 * DefaultResourceLoader 只扫描名为 SKILL.md 的文件，因此被重命名的技能对
 * pi-web 完全不可见，也无法从 pi-web 重新启用。
 *
 * 本模块补齐这一兼容层：
 *  - scanFileDisabledSkills(): 在技能根目录中扫描 SKILL.md.disabled，作为
 *    已禁用技能展示（disableModelInvocation=true, disabledByFile=true）。
 *  - isFileDisabledPath()/toEnabledSkillPath(): PATCH 启用时把 .disabled
 *    文件重命名回 SKILL.md。
 */

export const SKILL_FILE_NAME = "SKILL.md";
export const FILE_DISABLED_NAME = "SKILL.md.disabled";

export interface FileDisabledScanRoot {
  root: string;
  scope: "user" | "project";
}

export interface FileDisabledSkill {
  /** 当前实际存在的文件路径，即 .../SKILL.md.disabled */
  filePath: string;
  name: string;
  description: string;
  scope: "user" | "project";
}

export function isFileDisabledPath(filePath: string): boolean {
  return basename(filePath) === FILE_DISABLED_NAME;
}

/** 启用时重命名的目标路径：.../SKILL.md.disabled -> .../SKILL.md */
export function toEnabledSkillPath(disabledPath: string): string {
  return join(dirname(disabledPath), SKILL_FILE_NAME);
}

/**
 * 递归扫描技能根目录中的 SKILL.md.disabled 文件。
 *
 * 发现规则与 DefaultResourceLoader 的 loadSkillsFromDir 保持一致：
 *  - 目录含 SKILL.md.disabled 且无 SKILL.md -> 这是一个“被文件禁用的技能根”，
 *    记录之且不再向下递归；
 *  - 目录含 SKILL.md -> SKILL.md 为权威状态，忽略同目录的 .disabled（不记录、
 *    不递归），避免同一技能出现两份条目；
 *  - 递归时跳过隐藏目录与 node_modules；
 *  - 通过 realpath 去重，避免符号链接根导致同一物理文件出现两次。
 */
export function scanFileDisabledSkills(roots: FileDisabledScanRoot[]): FileDisabledSkill[] {
  const results: FileDisabledSkill[] = [];
  const seen = new Set<string>();
  for (const { root, scope } of roots) {
    scanDir(root, scope, results, seen);
  }
  return results;
}

function scanDir(
  dir: string,
  scope: "user" | "project",
  results: FileDisabledSkill[],
  seen: Set<string>,
): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const disabledEntry = entries.find((entry) => entry.name === FILE_DISABLED_NAME);
  const hasActiveSkill = entries.some((entry) => entry.name === SKILL_FILE_NAME);

  if (disabledEntry) {
    if (!hasActiveSkill) {
      const fullPath = join(dir, disabledEntry.name);
      let isFile = disabledEntry.isFile();
      if (disabledEntry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          isFile = false;
        }
      }
      if (isFile) {
        const skill = loadFileDisabledSkill(fullPath, scope);
        if (skill) {
          let realPath = fullPath;
          try {
            realPath = realpathSync(fullPath);
          } catch {
            // keep fullPath; broken symlink dedup is best-effort
          }
          if (!seen.has(realPath)) {
            seen.add(realPath);
            results.push(skill);
          }
        }
      }
    }
    // A directory that holds SKILL.md(.disabled) is a skill root — never recurse deeper,
    // mirroring the loader.
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(fullPath).isDirectory();
      } catch {
        continue; // broken symlink
      }
    }
    if (isDirectory) scanDir(fullPath, scope, results, seen);
  }
}

function loadFileDisabledSkill(
  filePath: string,
  scope: "user" | "project",
): FileDisabledSkill | null {
  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let frontmatter: Record<string, unknown>;
  try {
    ({ frontmatter } = parseFrontmatter<Record<string, unknown>>(rawContent));
  } catch {
    return null;
  }
  const description =
    typeof frontmatter.description === "string" && frontmatter.description.trim() !== ""
      ? frontmatter.description
      : undefined;
  if (!description) return null; // loader also requires a non-empty description
  const name =
    typeof frontmatter.name === "string" && frontmatter.name.trim() !== ""
      ? frontmatter.name
      : basename(dirname(filePath));
  return { filePath, name, description, scope };
}
