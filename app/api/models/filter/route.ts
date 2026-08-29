import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import {
  createAgentSessionServices,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveVisibleModels } from "@/lib/model-scope";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
} from "@/lib/file-access";
import {
  projectTrustReloadOptions,
  getProjectTrustStatus,
} from "@/lib/project-trust";
import { invalidateModelsCache } from "@/lib/models-cache";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let cwd = process.cwd();
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd");
    if (requestedCwd) cwd = resolve(requestedCwd);
  } catch {
    return NextResponse.json({ error: "Invalid request URL" }, { status: 400 });
  }
  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return NextResponse.json(
        { error: `Not a directory: ${cwd}` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: `Directory does not exist: ${cwd}` },
      { status: 400 },
    );
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const agentDir = getAgentDir();
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions
        ? { resourceLoaderReloadOptions: trustReloadOptions }
        : {}),
    });

    const allScope = await resolveVisibleModels(
      services.modelRuntime,
      undefined,
    );
    const enabledModels = services.settingsManager.getEnabledModels() ?? [];
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();

    return NextResponse.json({
      allModels: allScope.visible.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      })),
      enabledModels,
      defaultModel:
        defaultProvider && defaultModelId
          ? { provider: defaultProvider, modelId: defaultModelId }
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json(
      { error: "Untrusted API request" },
      { status: 403 },
    );
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  try {
    const body = (await req.json()) as {
      cwd?: string;
      enabledModels?: string[] | null;
    };
    const cwd = resolve(body.cwd || process.cwd());

    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const projectTrust = getProjectTrustStatus(cwd, agentDir);
    const settingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: projectTrust.trusted,
    });

    const patterns =
      Array.isArray(body.enabledModels) && body.enabledModels.length > 0
        ? body.enabledModels.filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          )
        : undefined;

    settingsManager.setEnabledModels(patterns);
    await settingsManager.flush();
    invalidateModelsCache();

    return NextResponse.json({
      success: true,
      enabledModels: patterns ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
