import { homedir } from "os";
import { dirname, join } from "path";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { scanFileDisabledSkills } from "@/lib/skill-file-disabled";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  const annotated = annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir });

  // skill-hub 类工具以物理重命名 (SKILL.md -> SKILL.md.disabled) 禁用技能，pi 的
  // loader 看不到这些文件。把它们扫描出来并以 disabledByFile 状态并入列表，
  // 这样 pi-web 既能展示它们，也能通过 PATCH 重命名回 SKILL.md 重新启用。
  const globalSkillsDir = join(homedir(), ".agents", "skills");
  const projectSkillsDir = join(cwd, ".pi", "skills");
  const fileDisabled = scanFileDisabledSkills([
    { root: globalSkillsDir, scope: "user" },
    { root: join(agentDir, "skills"), scope: "user" },
    { root: projectSkillsDir, scope: "project" },
  ]);
  const merged: SkillInfo[] = [
    ...annotated,
    ...fileDisabled.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      baseDir: dirname(s.filePath),
      disableModelInvocation: true,
      disabledByFile: true,
      sourceInfo: { source: "local", scope: s.scope },
    })),
  ];

  return {
    skills: merged,
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
