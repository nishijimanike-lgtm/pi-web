import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
      McpServerConfig,
      McpTransportType,
      RawMcpServerConfig,
} from "@/lib/mcp-config-store";

export const dynamic = "force-dynamic";

interface DiscoveredServer extends McpServerConfig {
      source: string;
}

export async function GET() {
      const discovered: DiscoveredServer[] = [];
      const home = homedir();

      // 1. VS Code MCP 配置
      const codePaths = [
            join(home, "AppData", "Roaming", "Code", "User", "mcp.json"),
            join(
                  home,
                  "Library",
                  "Application Support",
                  "Code",
                  "User",
                  "mcp.json",
            ),
            join(home, ".config", "Code", "User", "mcp.json"),
      ];

      for (const p of codePaths) {
            if (existsSync(p)) {
                  try {
                        const raw = JSON.parse(
                              readFileSync(p, "utf8"),
                        ) as Record<string, unknown>;
                        const servers = (raw.servers ||
                              raw.mcpServers ||
                              {}) as Record<string, RawMcpServerConfig>;
                        for (const [name, cfg] of Object.entries(servers)) {
                              if (cfg && typeof cfg === "object") {
                                    discovered.push({
                                          name,
                                          source: "VS Code",
                                          scope: "global",
                                          type:
                                                (cfg.type as
                                                      | McpTransportType
                                                      | undefined) ||
                                                (cfg.url ? "sse" : "stdio"),
                                          command: cfg.command,
                                          args: Array.isArray(cfg.args)
                                                ? cfg.args.map(String)
                                                : undefined,
                                          env: cfg.env,
                                          url: cfg.url,
                                          disabled: cfg.disabled === true,
                                          description: `Imported from VS Code (${name})`,
                                    });
                              }
                        }
                  } catch {
                        // Ignore read errors
                  }
            }
      }

      // 2. Claude Desktop 配置
      const claudePaths = [
            join(
                  home,
                  "AppData",
                  "Roaming",
                  "Claude",
                  "claude_desktop_config.json",
            ),
            join(
                  home,
                  "Library",
                  "Application Support",
                  "Claude",
                  "claude_desktop_config.json",
            ),
            join(home, ".config", "Claude", "claude_desktop_config.json"),
      ];

      for (const p of claudePaths) {
            if (existsSync(p)) {
                  try {
                        const raw = JSON.parse(
                              readFileSync(p, "utf8"),
                        ) as Record<string, unknown>;
                        const servers = (raw.mcpServers ||
                              raw.servers ||
                              {}) as Record<string, RawMcpServerConfig>;
                        for (const [name, cfg] of Object.entries(servers)) {
                              if (cfg && typeof cfg === "object") {
                                    discovered.push({
                                          name,
                                          source: "Claude Desktop",
                                          scope: "global",
                                          type:
                                                (cfg.type as
                                                      | McpTransportType
                                                      | undefined) ||
                                                (cfg.url ? "sse" : "stdio"),
                                          command: cfg.command,
                                          args: Array.isArray(cfg.args)
                                                ? cfg.args.map(String)
                                                : undefined,
                                          env: cfg.env,
                                          url: cfg.url,
                                          disabled: cfg.disabled === true,
                                          description: `Imported from Claude Desktop (${name})`,
                                    });
                              }
                        }
                  } catch {
                        // Ignore read errors
                  }
            }
      }

  // 3. 全局安装的 npm MCP 工具 (如 @drawio/mcp)
  const npmDrawio = join(home, "AppData", "Roaming", "npm", "node_modules", "@drawio", "mcp", "src", "index.js");
  if (existsSync(npmDrawio)) {
    discovered.push({
      name: "drawio",
      source: "Global npm (@drawio/mcp)",
      scope: "global",
      type: "stdio",
      command: "node",
      args: [npmDrawio],
      disabled: false,
      description: "Official draw.io MCP server (diagrams & workflows)",
    });
  }

  return NextResponse.json({ discovered });
}
