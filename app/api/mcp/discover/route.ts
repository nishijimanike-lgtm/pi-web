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

      // 3. Cursor MCP 配置
      const cursorPaths = [
            join(home, ".cursor", "mcp.json"),
      ];

      for (const p of cursorPaths) {
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
                                          source: "Cursor",
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
                                          description: `Imported from Cursor (${name})`,
                                    });
                              }
                        }
                  } catch {
                        // Ignore read errors
                  }
            }
      }

      // 4. Claude Code 配置 (~/.claude.json)
      const claudeCodePaths = [
            join(home, ".claude.json"),
            join(home, ".claude", "mcp.json"),
      ];

      for (const p of claudeCodePaths) {
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
                                    // 避免与已有同名重复
                                    if (discovered.some((d) => d.name === name)) continue;
                                    discovered.push({
                                          name,
                                          source: "Claude Code",
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
                                          description: `Imported from Claude Code (${name})`,
                                    });
                              }
                        }
                  } catch {
                        // Ignore read errors
                  }
            }
      }

  // 5. 全局安装的 npm MCP 工具
  const npmOfficeCli = join(home, "AppData", "Roaming", "npm", "node_modules", "@officecli", "officecli", "vendor", "officecli.exe");
  if (existsSync(npmOfficeCli) && !discovered.some((d) => d.name === "officecli")) {
    discovered.push({
      name: "officecli",
      source: "Global npm (@officecli/officecli)",
      scope: "global",
      type: "stdio",
      command: npmOfficeCli,
      args: ["mcp"],
      disabled: false,
      description: "officecli: AI-friendly CLI for Office documents (.docx, .xlsx, .pptx)",
    });
  }

  const npmGitNexus = join(home, "AppData", "Roaming", "npm", "node_modules", "gitnexus", "dist", "cli", "index.js");
  if (existsSync(npmGitNexus) && !discovered.some((d) => d.name === "gitnexus")) {
    discovered.push({
      name: "gitnexus",
      source: "Global npm (gitnexus)",
      scope: "global",
      type: "stdio",
      command: "node",
      args: [npmGitNexus, "mcp"],
      disabled: false,
      description: "GitNexus code intelligence & knowledge graph MCP server",
    });
  }

  const npmDrawio = join(home, "AppData", "Roaming", "npm", "node_modules", "@drawio", "mcp", "src", "index.js");
  if (existsSync(npmDrawio) && !discovered.some((d) => d.name === "drawio")) {
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
