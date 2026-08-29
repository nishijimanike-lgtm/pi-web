import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
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

// PATCH /api/skills — toggle disable-model-invocation on SKILL.md file(s)
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
      const content = readFileSync(item.filePath, "utf8");
      const updated = setDisableModelInvocation(content, item.disableModelInvocation);
      writeFileSync(item.filePath, updated, "utf8");
    }

    return NextResponse.json({ success: true, count: items.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
