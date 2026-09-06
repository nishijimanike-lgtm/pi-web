import { NextResponse } from "next/server";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
import { isFileDisabledPath, toEnabledSkillPath } from "@/lib/skill-file-disabled";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/skills — toggle skill enabled state.
// - SKILL.md files: set/clear the disable-model-invocation frontmatter key (pi-web native).
// - SKILL.md.disabled files (skill-hub-style rename): enabling renames the file back to
//   SKILL.md and clears the frontmatter key; disabling keeps the rename (already disabled).
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      filePath?: string;
      disableModelInvocation?: boolean;
      items?: { filePath: string; disableModelInvocation: boolean }[];
    };

    const items: { filePath: string; disableModelInvocation: boolean }[] = [];
    if (Array.isArray(body.items)) {
      items.push(...body.items);
    } else if (typeof body.filePath === "string") {
      items.push({
        filePath: body.filePath,
        disableModelInvocation: Boolean(body.disableModelInvocation),
      });
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "filePath or items required" }, { status: 400 });
    }

    const allowedRoots = new Set(await getAllowedFileRoots());
    allowedRoots.add(getAgentDir());
    // Globally installed skills live in ~/.agents/skills and are symlinked into
    // the agent's skills dir; isExistingFilePathAllowed resolves the symlink, so
    // the real target sits outside getAgentDir(). Allow the global skills root
    // too (the SDK always treats ~/.agents/skills as trusted).
    const globalSkillsDir = path.join(homedir(), ".agents", "skills");
    if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);

    for (const item of items) {
      if (!existsSync(item.filePath)) {
        return NextResponse.json({ error: `File not found: ${item.filePath}` }, { status: 404 });
      }
      if (!isExistingFilePathAllowed(item.filePath, allowedRoots)) {
        return NextResponse.json({ error: `Access denied: ${item.filePath}` }, { status: 403 });
      }
    }

    for (const item of items) {
      if (isFileDisabledPath(item.filePath)) {
        // skill-hub 风格禁用：物理重命名 SKILL.md -> SKILL.md.disabled。
        // 启用 = 重命名回 SKILL.md 并清除 frontmatter 标记（避免残留的
        // disable-model-invocation 让重命名后的技能仍处于禁用状态）；
        // 禁用 = 文件本身已是禁用态，补写标记保证两套机制状态一致。
        if (item.disableModelInvocation) {
          const content = readFileSync(item.filePath, "utf8");
          writeFileSync(item.filePath, setDisableModelInvocation(content, true), "utf8");
        } else {
          const target = toEnabledSkillPath(item.filePath);
          if (existsSync(target)) {
            return NextResponse.json(
              { error: `Cannot enable: ${target} already exists. Remove it first so the disabled copy can be restored.` },
              { status: 409 },
            );
          }
          const content = readFileSync(item.filePath, "utf8");
          const updated = setDisableModelInvocation(content, false);
          renameSync(item.filePath, target);
          writeFileSync(target, updated, "utf8");
        }
        continue;
      }
      const content = readFileSync(item.filePath, "utf8");
      const updated = setDisableModelInvocation(content, item.disableModelInvocation);
      writeFileSync(item.filePath, updated, "utf8");
    }

    return NextResponse.json({ success: true, count: items.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
