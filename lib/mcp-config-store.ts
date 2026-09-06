import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export type McpTransportType = "stdio" | "sse" | "http";

export interface McpServerConfig {
  name: string;
  scope: "global" | "project";
  type?: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  description?: string;
}

export interface RawMcpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  description?: string;
  [key: string]: unknown;
}

export interface McpConfigFile {
  mcpServers?: Record<string, RawMcpServerConfig>;
  servers?: Record<string, RawMcpServerConfig>;
  [key: string]: unknown;
}

export function getGlobalMcpConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "mcp.json");
}

export function resolveProjectMcpConfigPath(cwd: string): string {
  const preferred = join(cwd, ".pi", "agent", "mcp.json");
  if (existsSync(preferred)) return preferred;

  const dotMcp = join(cwd, ".mcp.json");
  if (existsSync(dotMcp)) return dotMcp;

  const rootMcp = join(cwd, "mcp.json");
  if (existsSync(rootMcp)) return rootMcp;

  return preferred;
}

export function readMcpFile(filePath: string): McpConfigFile {
  if (!existsSync(filePath)) {
    return { mcpServers: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as McpConfigFile;
    }
    return { mcpServers: {} };
  } catch {
    return { mcpServers: {} };
  }
}

export function extractServers(config: McpConfigFile): Record<string, RawMcpServerConfig> {
  const servers: Record<string, RawMcpServerConfig> = {};

  if (config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)) {
    Object.assign(servers, config.mcpServers);
  }

  if (config.servers && typeof config.servers === "object" && !Array.isArray(config.servers)) {
    for (const [key, val] of Object.entries(config.servers)) {
      if (!servers[key] && val && typeof val === "object") {
        servers[key] = val;
      }
    }
  }

  return servers;
}

export function writeMcpFile(filePath: string, config: McpConfigFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writePrivateFileAtomicSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

export function listMcpServers(cwd?: string | null): {
  servers: McpServerConfig[];
  globalConfigPath: string;
  projectConfigPath: string | null;
  projectAvailable: boolean;
} {
  const globalPath = getGlobalMcpConfigPath();
  const globalConfig = readMcpFile(globalPath);
  const globalEntries = extractServers(globalConfig);

  const result: McpServerConfig[] = [];

  for (const [name, raw] of Object.entries(globalEntries)) {
    if (!raw || typeof raw !== "object") continue;
    result.push({
      name,
      scope: "global",
      type: (raw.type as McpTransportType) || (raw.url ? "sse" : "stdio"),
      command: typeof raw.command === "string" ? raw.command : undefined,
      args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
      env: raw.env && typeof raw.env === "object" ? (raw.env as Record<string, string>) : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
      headers: raw.headers && typeof raw.headers === "object" ? (raw.headers as Record<string, string>) : undefined,
      disabled: raw.disabled === true,
      description: typeof raw.description === "string" ? raw.description : undefined,
    });
  }

  let projectPath: string | null = null;
  const projectAvailable = Boolean(cwd && typeof cwd === "string" && cwd.trim().length > 0);

  if (projectAvailable && cwd) {
    projectPath = resolveProjectMcpConfigPath(cwd);
    const projectConfig = readMcpFile(projectPath);
    const projectEntries = extractServers(projectConfig);

    for (const [name, raw] of Object.entries(projectEntries)) {
      if (!raw || typeof raw !== "object") continue;
      result.push({
        name,
        scope: "project",
        type: (raw.type as McpTransportType) || (raw.url ? "sse" : "stdio"),
        command: typeof raw.command === "string" ? raw.command : undefined,
        args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
        env: raw.env && typeof raw.env === "object" ? (raw.env as Record<string, string>) : undefined,
        url: typeof raw.url === "string" ? raw.url : undefined,
        headers: raw.headers && typeof raw.headers === "object" ? (raw.headers as Record<string, string>) : undefined,
        disabled: raw.disabled === true,
        description: typeof raw.description === "string" ? raw.description : undefined,
      });
    }
  }

  return {
    servers: result,
    globalConfigPath: globalPath,
    projectConfigPath: projectPath,
    projectAvailable,
  };
}

export function saveMcpServer(
  scope: "global" | "project",
  name: string,
  serverData: Partial<McpServerConfig>,
  cwd?: string | null,
  oldName?: string,
): McpServerConfig {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Server name cannot be empty");
  }

  const filePath = scope === "project"
    ? (cwd ? resolveProjectMcpConfigPath(cwd) : null)
    : getGlobalMcpConfigPath();

  if (!filePath) {
    throw new Error("Project path is required for project scope");
  }

  const file = readMcpFile(filePath);
  const serversKey = file.mcpServers ? "mcpServers" : file.servers ? "servers" : "mcpServers";
  const servers = (file[serversKey] ?? {}) as Record<string, RawMcpServerConfig>;

  if (oldName && oldName !== trimmedName && servers[oldName]) {
    delete servers[oldName];
  }

  const rawServer: RawMcpServerConfig = {
    ...servers[trimmedName],
    type: serverData.type ?? "stdio",
    disabled: serverData.disabled ?? false,
  };

  if (serverData.command !== undefined) {
    rawServer.command = serverData.command.trim();
  }
  if (serverData.args !== undefined) {
    rawServer.args = serverData.args;
  }
  if (serverData.env !== undefined) {
    rawServer.env = serverData.env;
  }
  if (serverData.url !== undefined) {
    rawServer.url = serverData.url.trim();
  }
  if (serverData.headers !== undefined) {
    rawServer.headers = serverData.headers;
  }
  if (serverData.description !== undefined) {
    rawServer.description = serverData.description.trim() || undefined;
  }

  servers[trimmedName] = rawServer;
  file[serversKey] = servers;

  writeMcpFile(filePath, file);

  return {
    name: trimmedName,
    scope,
    type: rawServer.type as McpTransportType,
    command: rawServer.command,
    args: rawServer.args,
    env: rawServer.env,
    url: rawServer.url,
    headers: rawServer.headers,
    disabled: rawServer.disabled,
    description: rawServer.description,
  };
}

export function deleteMcpServer(
  scope: "global" | "project",
  name: string,
  cwd?: string | null,
): void {
  const filePath = scope === "project"
    ? (cwd ? resolveProjectMcpConfigPath(cwd) : null)
    : getGlobalMcpConfigPath();

  if (!filePath || !existsSync(filePath)) return;

  const file = readMcpFile(filePath);
  const serversKey = file.mcpServers ? "mcpServers" : file.servers ? "servers" : "mcpServers";
  const servers = (file[serversKey] ?? {}) as Record<string, RawMcpServerConfig>;

  if (servers[name]) {
    delete servers[name];
    file[serversKey] = servers;
    writeMcpFile(filePath, file);
  }
}

export function toggleMcpServer(
  scope: "global" | "project",
  name: string,
  disabled: boolean,
  cwd?: string | null,
): McpServerConfig {
  const filePath = scope === "project"
    ? (cwd ? resolveProjectMcpConfigPath(cwd) : null)
    : getGlobalMcpConfigPath();

  if (!filePath) {
    throw new Error("Target configuration file not found");
  }

  const file = readMcpFile(filePath);
  const serversKey = file.mcpServers ? "mcpServers" : file.servers ? "servers" : "mcpServers";
  const servers = (file[serversKey] ?? {}) as Record<string, RawMcpServerConfig>;

  if (!servers[name]) {
    throw new Error(`MCP server "${name}" not found in ${scope} config`);
  }

  servers[name] = {
    ...servers[name],
    disabled,
  };
  file[serversKey] = servers;
  writeMcpFile(filePath, file);

  const raw = servers[name];
  return {
    name,
    scope,
    type: (raw.type as McpTransportType) || (raw.url ? "sse" : "stdio"),
    command: raw.command,
    args: raw.args,
    env: raw.env,
    url: raw.url,
    headers: raw.headers,
    disabled: raw.disabled,
    description: raw.description,
  };
}
