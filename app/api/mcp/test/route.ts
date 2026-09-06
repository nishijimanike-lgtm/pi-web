import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import type { McpServerConfig } from "@/lib/mcp-config-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const start = performance.now();
  try {
    const body = (await req.json()) as { server: Partial<McpServerConfig> };
    const server = body.server;

    if (!server) {
      return NextResponse.json({ ok: false, error: "Server config required" }, { status: 400 });
    }

    const type = server.type ?? "stdio";

    if (type === "stdio") {
      const command = server.command?.trim();
      if (!command) {
        return NextResponse.json({ ok: false, error: "Command is required for stdio type" }, { status: 400 });
      }

      const args = Array.isArray(server.args) ? server.args : [];
      const env = {
        ...process.env,
        ...(server.env ?? {}),
      };

      // 尝试启动进程并测试其能否成功响应或至少进程正常创建
      const testResult = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        let proc: ReturnType<typeof spawn> | null = null;
        let resolved = false;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          if (proc) {
            try {
              proc.kill();
            } catch {
              // Ignore kill errors
            }
          }
        };

        const done = (ok: boolean, message: string) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve({ ok, message });
        };

        timer = setTimeout(() => {
          // 如果在 4 秒内进程仍活着且没有报错，说明进程正常启动运行了
          done(true, "Process started and active");
        }, 3000);

        try {
          proc = spawn(command, args, {
            env,
            shell: process.platform === "win32",
            windowsHide: true,
          });

          proc.on("error", (err) => {
            done(false, `Failed to execute: ${err.message}`);
          });

          proc.on("exit", (code) => {
            if (code === 0) {
              done(true, "Command executed successfully (exit code 0)");
            } else {
              done(false, `Process exited early with code ${code}`);
            }
          });

          // 尝试发送 MCP ping 探测
          try {
            const initMsg = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "pi-web-mcp-tester", version: "1.0.0" },
              },
            }) + "\n";
            proc.stdin?.write(initMsg);
          } catch {
            // Write may fail if process already closed
          }
        } catch (err) {
          done(false, err instanceof Error ? err.message : String(err));
        }
      });

      const latencyMs = Math.round(performance.now() - start);
      return NextResponse.json({
        ok: testResult.ok,
        message: testResult.message,
        latencyMs,
      });
    }

    if (type === "sse" || type === "http") {
      const urlStr = server.url?.trim();
      if (!urlStr) {
        return NextResponse.json({ ok: false, error: "URL is required for SSE/HTTP" }, { status: 400 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const res = await fetch(urlStr, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream, application/json, text/plain, */*",
            ...(server.headers ?? {}),
          },
        });
        clearTimeout(timeout);

        const latencyMs = Math.round(performance.now() - start);
        return NextResponse.json({
          ok: res.ok || res.status < 500,
          message: `HTTP ${res.status} ${res.statusText}`,
          latencyMs,
        });
      } catch (err) {
        clearTimeout(timeout);
        const latencyMs = Math.round(performance.now() - start);
        return NextResponse.json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
        });
      }
    }

    return NextResponse.json({ ok: false, error: `Unsupported type: ${type}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
