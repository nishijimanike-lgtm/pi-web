import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import {
  deleteMcpServer,
  listMcpServers,
  saveMcpServer,
  toggleMcpServer,
  type McpServerConfig,
} from "@/lib/mcp-config-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cwd = searchParams.get("cwd");

    if (cwd) {
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const data = listMcpServers(cwd);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      scope?: "global" | "project";
      name?: string;
      server?: Partial<McpServerConfig>;
      cwd?: string;
    };

    const scope = body.scope ?? "global";
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Server name is required" }, { status: 400 });
    }

    if (scope === "project") {
      if (!body.cwd) {
        return NextResponse.json({ error: "cwd is required for project scope" }, { status: 400 });
      }
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const saved = saveMcpServer(scope, name, body.server ?? {}, body.cwd);
    return NextResponse.json({ success: true, server: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      scope?: "global" | "project";
      oldName?: string;
      name?: string;
      server?: Partial<McpServerConfig>;
      cwd?: string;
    };

    const scope = body.scope ?? "global";
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Server name is required" }, { status: 400 });
    }

    if (scope === "project") {
      if (!body.cwd) {
        return NextResponse.json({ error: "cwd is required for project scope" }, { status: 400 });
      }
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const saved = saveMcpServer(scope, name, body.server ?? {}, body.cwd, body.oldName);
    return NextResponse.json({ success: true, server: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");
    const scope = (searchParams.get("scope") as "global" | "project") || "global";
    const cwd = searchParams.get("cwd");

    if (!name) {
      return NextResponse.json({ error: "name parameter required" }, { status: 400 });
    }

    if (scope === "project") {
      if (!cwd) {
        return NextResponse.json({ error: "cwd required for project scope" }, { status: 400 });
      }
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    deleteMcpServer(scope, name, cwd);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      scope?: "global" | "project";
      name?: string;
      disabled?: boolean;
      cwd?: string;
    };

    const scope = body.scope ?? "global";
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Server name is required" }, { status: 400 });
    }
    if (typeof body.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled boolean is required" }, { status: 400 });
    }

    if (scope === "project") {
      if (!body.cwd) {
        return NextResponse.json({ error: "cwd is required for project scope" }, { status: 400 });
      }
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const updated = toggleMcpServer(scope, name, body.disabled, body.cwd);
    return NextResponse.json({ success: true, server: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
