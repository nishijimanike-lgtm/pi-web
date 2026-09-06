"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/hooks/useI18n";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import type { McpServerConfig, McpTransportType } from "@/lib/mcp-config-store";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";

interface Props {
  embedded?: boolean;
  cwd?: string | null;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}

interface ServerFormState {
  isNew: boolean;
  originalName: string;
  name: string;
  scope: "global" | "project";
  type: McpTransportType;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  description: string;
  disabled: boolean;
}
interface DiscoveredMcpServer extends McpServerConfig {
  source: string;
}

interface McpPreset {
  id: string;
  label: string;
  description: string;
  defaultConfig: Partial<McpServerConfig>;
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: "filesystem",
    label: "Local Filesystem",
    description: "Read and write files within allowed paths",
    defaultConfig: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      description: "MCP filesystem server",
    },
  },
  {
    id: "memory",
    label: "Knowledge Graph Memory",
    description: "Persistent graph-based memory service",
    defaultConfig: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      description: "MCP persistent memory server",
    },
  },
  {
    id: "fetch",
    label: "Web Fetch",
    description: "Fetch web content and convert HTML to markdown",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-fetch"],
      description: "Web fetch and html conversion",
    },
  },
  {
    id: "github",
    label: "GitHub API",
    description: "Manage GitHub repositories, pull requests, and issues",
    defaultConfig: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
      description: "GitHub MCP server",
    },
  },
  {
    id: "excel",
    label: "Excel Spreadsheet",
    description: "Read, write, and manipulate Excel .xlsx files",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["excel-mcp-server", "stdio"],
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      description: "Excel MCP tools for Pi",
    },
  },
  {
    id: "word-document",
    label: "Word Document",
    description: "Create, inspect, and edit Microsoft Word (.docx) documents",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["--from", "office-word-mcp-server", "word_mcp_server"],
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      description: "Word Document MCP Server",
    },
  },
  {
    id: "pdf-manipulation",
    label: "PDF Manipulation",
    description: "Extract text, split, merge, and inspect PDF files",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["--from", "pdf-manipulation-mcp-server", "--with", "mcp<2", "--with", "pymupdf<1.25.0", "pdf-mcp-server"],
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      description: "PDF Manipulation MCP Server",
    },
  },
  {
    id: "sas",
    label: "SAS 9.4 Statistical",
    description: "SAS 9.4 batch processing and dataset conversion bridge",
    defaultConfig: {
      type: "stdio",
      command: "D:\\统计分析\\sas-mcp-server\\.venv\\Scripts\\python.exe",
      args: ["D:\\统计分析\\sas-mcp-server\\server.py"],
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", SAS_MCP_SERVER_DIR: "D:\\统计分析\\sas-mcp-server" },
      description: "SAS 9.4 statistical analysis MCP server",
    },
  },
  {
    id: "powerpoint",
    label: "PowerPoint (ppt-mcp)",
    description: "Live control of Microsoft PowerPoint via COM automation (156 tools)",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["ppt-mcp"],
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PPT_AUTO_DISMISS_DIALOG: "true" },
      description: "PowerPoint MCP Server (ppt-mcp)",
    },
  },
  {
    id: "sqlite",
    label: "SQLite Database",
    description: "Inspect and query SQLite databases",
    defaultConfig: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-sqlite", "--db-path", "./data.db"],
      description: "SQLite database explorer",
    },
  },
  {
    id: "drawio",
    label: "Draw.io Diagrams",
    description: "Official draw.io MCP server (XML, CSV, Mermaid diagrams)",
    defaultConfig: {
      type: "stdio",
      command: "node",
      args: ["C:\\Users\\zhang\\AppData\\Roaming\\npm\\node_modules\\@drawio\\mcp\\src\\index.js"],
      description: "Official draw.io MCP server",
    },
  },
  {
    id: "remote-sse",
    label: "Remote SSE Server",
    description: "Connect to a remote MCP endpoint over Server-Sent Events",
    defaultConfig: {
      type: "sse",
      url: "http://localhost:8000/sse",
      description: "Remote MCP SSE service",
    },
  },
];

function envToText(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = val;
    }
  }
  return env;
}

function argsToText(args?: string[]): string {
  if (!args || args.length === 0) return "";
  return args.join("\n");
}

function textToArgs(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const args: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) args.push(trimmed);
  }
  return args;
}

export function McpConfig({ embedded = false, cwd, sessionId, onClose, onReloaded }: Props) {
  const { t } = useI18n();

  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredMcpServer[]>([]);

  const selectServer = useCallback((server: McpServerConfig) => {
    const key = `${server.scope}:${server.name}`;
    setSelectedKey(key);
    setLastSettingsSelection("mcp", key, cwd);
    setTestResult(null);
    setStatusMessage(null);
    setForm({
      isNew: false,
      originalName: server.name,
      name: server.name,
      scope: server.scope,
      type: server.type ?? (server.url ? "sse" : "stdio"),
      command: server.command ?? "",
      argsText: argsToText(server.args),
      envText: envToText(server.env),
      url: server.url ?? "",
      description: server.description ?? "",
      disabled: server.disabled ?? false,
    });
  }, [cwd]);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = cwd ? `/api/mcp?cwd=${encodeURIComponent(cwd)}` : "/api/mcp";
      const res = await fetch(url);
      const data = (await res.json()) as { servers?: McpServerConfig[]; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const list = data.servers ?? [];
      setServers(list);

      // Restore selection
      const remembered = getLastSettingsSelection("mcp", cwd);
      if (remembered) {
        const found = list.find((s) => `${s.scope}:${s.name}` === remembered);
        if (found) {
          selectServer(found);
          return;
        }
      }

      if (list.length > 0) {
        selectServer(list[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, selectServer]);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/mcp/discover")
      .then((res) => res.json())
      .then((data: { discovered?: DiscoveredMcpServer[] }) => {
        if (!cancelled && Array.isArray(data.discovered)) {
          setDiscoveredServers(data.discovered);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartNew = (preset?: McpPreset | DiscoveredMcpServer) => {
    const initScope: "global" | "project" = cwd ? "project" : "global";
    const baseConfig: Partial<McpServerConfig> =
      preset && "defaultConfig" in preset
        ? preset.defaultConfig
        : (preset ?? {});
    const presetDesc = preset && "description" in preset && typeof preset.description === "string" ? preset.description : "";
    const key = "__new__";
    setSelectedKey(key);
    setTestResult(null);
    setStatusMessage(null);
    setForm({
      isNew: true,
      originalName: "",
      name: preset ? ("id" in preset ? preset.id : preset.name) : "",
      scope: initScope,
      type: (baseConfig.type as McpTransportType) ?? "stdio",
      command: baseConfig.command ?? "",
      argsText: argsToText(baseConfig.args),
      envText: envToText(baseConfig.env),
      url: baseConfig.url ?? "",
      description: baseConfig.description ?? presetDesc,
      disabled: false,
    });
  };

  const handleToggleDisabled = async (server: McpServerConfig) => {
    const nextDisabled = !server.disabled;
    try {
      const res = await fetch("/api/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: server.scope,
          name: server.name,
          disabled: nextDisabled,
          cwd,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; server?: McpServerConfig };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setServers((prev) =>
        prev.map((s) => (s.scope === server.scope && s.name === server.name ? { ...s, disabled: nextDisabled } : s)),
      );

      if (form && form.scope === server.scope && form.name === server.name) {
        setForm((prev) => (prev ? { ...prev, disabled: nextDisabled } : null));
      }

      if (sessionId) {
        void sendAgentCommand(sessionId, { type: "reload" });
        onReloaded?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    if (!form) return;
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError(t("mcp.nameRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      const serverPayload: Partial<McpServerConfig> = {
        type: form.type,
        command: form.command.trim() || undefined,
        args: textToArgs(form.argsText),
        env: textToEnv(form.envText),
        url: form.url.trim() || undefined,
        description: form.description.trim() || undefined,
        disabled: form.disabled,
      };

      const method = form.isNew ? "POST" : "PUT";
      const res = await fetch("/api/mcp", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: form.scope,
          name: trimmedName,
          oldName: form.isNew ? undefined : form.originalName,
          server: serverPayload,
          cwd,
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string; server?: McpServerConfig };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const savedServer = data.server ?? {
        name: trimmedName,
        scope: form.scope,
        ...serverPayload,
      };

      setStatusMessage(t("mcp.saved"));

      await fetchServers();
      selectServer(savedServer);

      if (sessionId) {
        void sendAgentCommand(sessionId, { type: "reload" });
        onReloaded?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form || form.isNew) return;
    if (!window.confirm(t("mcp.deleteConfirm"))) return;

    setError(null);
    try {
      const params = new URLSearchParams({
        name: form.originalName,
        scope: form.scope,
      });
      if (cwd) params.set("cwd", cwd);

      const res = await fetch(`/api/mcp?${params.toString()}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setForm(null);
      setSelectedKey(null);
      await fetchServers();

      if (sessionId) {
        void sendAgentCommand(sessionId, { type: "reload" });
        onReloaded?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTestConnection = async () => {
    if (!form) return;
    setTesting(true);
    setTestResult(null);

    try {
      const serverPayload: Partial<McpServerConfig> = {
        type: form.type,
        command: form.command.trim() || undefined,
        args: textToArgs(form.argsText),
        env: textToEnv(form.envText),
        url: form.url.trim() || undefined,
      };

      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: serverPayload }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string; latencyMs?: number };
      if (!res.ok || data.error) {
        setTestResult({
          ok: false,
          message: data.error ?? `HTTP ${res.status}`,
        });
      } else {
        const msText = data.latencyMs !== undefined ? ` (${data.latencyMs}ms)` : "";
        setTestResult({
          ok: Boolean(data.ok),
          message: `${data.message ?? (data.ok ? t("mcp.testSuccess") : t("mcp.testFailed"))}${msText}`,
        });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const filteredServers = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)),
    );
  }, [servers, filterQuery]);

  const globalServers = useMemo(
    () => filteredServers.filter((s) => s.scope === "global"),
    [filteredServers],
  );

  const projectServers = useMemo(
    () => filteredServers.filter((s) => s.scope === "project"),
    [filteredServers],
  );

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("common.mcp")}
      subtitle={cwd ? t("mcp.scope.project") : t("mcp.scope.global")}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigListAction
            active={selectedKey === "__new__"}
            onClick={() => handleStartNew()}
          >
            {t("mcp.new")}
          </ConfigListAction>

          <div style={{ padding: "0 8px 8px" }}>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("skills.searchPlaceholder")}
              aria-label={t("skills.searchPlaceholder")}
              style={{
                width: "100%",
                height: 28,
                fontSize: 12,
                padding: "0 8px",
                borderRadius: 5,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                outline: "none",
              }}
            />
          </div>

          <ConfigSidebarList>
            {globalServers.length > 0 && (
              <>
                <ConfigSidebarGroupLabel>
                  {t("mcp.scope.global")} ({globalServers.length})
                </ConfigSidebarGroupLabel>
                {globalServers.map((server) => {
                  const key = `global:${server.name}`;
                  const isSelected = selectedKey === key;
                  return (
                    <ConfigSidebarItem
                      key={key}
                      active={isSelected}
                      onClick={() => selectServer(server)}
                    >
                      <ConfigStatusDot active={!server.disabled} />
                      <ConfigSidebarText>{server.name}</ConfigSidebarText>
                    </ConfigSidebarItem>
                  );
                })}
              </>
            )}

            {Boolean(cwd) && (
              <>
                <ConfigSidebarGroupLabel>
                  {t("mcp.scope.project")} ({projectServers.length})
                </ConfigSidebarGroupLabel>
                {projectServers.length === 0 ? (
                  <div
                    style={{
                      padding: "4px 10px 10px",
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    {t("mcp.noProjectServers")}
                  </div>
                ) : (
                  projectServers.map((server) => {
                    const key = `project:${server.name}`;
                    const isSelected = selectedKey === key;
                    return (
                      <ConfigSidebarItem
                        key={key}
                        active={isSelected}
                        onClick={() => selectServer(server)}
                      >
                        <ConfigStatusDot active={!server.disabled} />
                        <ConfigSidebarText>{server.name}</ConfigSidebarText>
                      </ConfigSidebarItem>
                    );
                  })
                )}
              </>
            )}

            {filteredServers.length === 0 && !loading && (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: 12,
                  color: "var(--text-dim)",
                  textAlign: "center",
                }}
              >
                {t("mcp.noServers")}
              </div>
            )}
          </ConfigSidebarList>
        </ConfigSidebar>

        <ConfigDetail>
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 16,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {!form ? (
            <ConfigEmptyState>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: "0 0 14px", color: "var(--text-muted)" }}>
                  {t("mcp.empty")}
                </p>
                <ConfigButton variant="primary" onClick={() => handleStartNew()}>
                  {t("mcp.new")}
                </ConfigButton>
              </div>
            </ConfigEmptyState>
          ) : (
            <ConfigDetailStack>
              <ConfigDetailHeader>
                <ConfigDetailHeaderInfo>
                  <ConfigDetailTitle>
                    {form.isNew ? t("mcp.new") : form.name}
                  </ConfigDetailTitle>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 4,
                      fontSize: 12,
                      color: "var(--text-dim)",
                    }}
                  >
                    <span>
                      {form.scope === "project" ? t("mcp.scope.project") : t("mcp.scope.global")}
                    </span>
                    <span>·</span>
                    <span
                      style={{
                        textTransform: "uppercase",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--bg-hover)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {form.type}
                    </span>
                  </div>
                </ConfigDetailHeaderInfo>

                <ConfigDetailActions>
                  {!form.isNew && (
                    <>
                      <ConfigSwitch
                        checked={!form.disabled}
                        label={form.disabled ? t("mcp.disabled") : t("mcp.enabled")}
                        onChange={() => {
                          const s = servers.find((item) => item.scope === form.scope && item.name === form.originalName);
                          if (s) void handleToggleDisabled(s);
                        }}
                      />
                      <ConfigButton
                        variant="danger"
                        size="small"
                        onClick={() => void handleDelete()}
                      >
                        {t("mcp.delete")}
                      </ConfigButton>
                    </>
                  )}
                </ConfigDetailActions>
              </ConfigDetailHeader>

              {form.isNew && (
                <ConfigField label={t("mcp.presets")}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    {MCP_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleStartNew(preset)}
                        title={preset.description}
                        style={{
                          fontSize: 11,
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          background: "var(--bg-hover)",
                          color: "var(--text)",
                          cursor: "pointer",
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </ConfigField>
              )}

              {form.isNew && discoveredServers.length > 0 && (
                <ConfigField label={t("mcp.discovered")}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    {discoveredServers.map((item) => (
                      <button
                        key={`${item.source}:${item.name}`}
                        type="button"
                        onClick={() => handleStartNew(item)}
                        title={item.description}
                        style={{
                          fontSize: 11,
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid var(--accent)",
                          background: "var(--bg-selected, rgba(59, 130, 246, 0.12))",
                          color: "var(--text)",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{item.name}</span>
                        <span style={{ fontSize: 9.5, opacity: 0.75, textTransform: "uppercase" }}>{item.source}</span>
                      </button>
                    ))}
                  </div>
                </ConfigField>
              )}

              <ConfigSectionTitle>{t("mcp.basicSettings")}</ConfigSectionTitle>

              <ConfigField label={t("mcp.name")}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("mcp.namePlaceholder")}
                  style={{
                    width: "100%",
                    height: 32,
                    fontSize: 13,
                    padding: "0 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    outline: "none",
                  }}
                />
              </ConfigField>

              {Boolean(cwd) && (
                <ConfigField label={t("mcp.scope")}>
                  <select
                    value={form.scope}
                    disabled={!form.isNew}
                    onChange={(e) => setForm({ ...form, scope: e.target.value as "global" | "project" })}
                    style={{
                      width: "100%",
                      height: 32,
                      fontSize: 13,
                      padding: "0 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                    }}
                  >
                    <option value="global">{t("mcp.scope.global")}</option>
                    <option value="project">{t("mcp.scope.project")}</option>
                  </select>
                </ConfigField>
              )}

              <ConfigField label={t("mcp.type")}>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as McpTransportType })}
                  style={{
                    width: "100%",
                    height: 32,
                    fontSize: 13,
                    padding: "0 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    outline: "none",
                  }}
                >
                  <option value="stdio">stdio (Local Command / Process)</option>
                  <option value="sse">sse (Server-Sent Events)</option>
                  <option value="http">http (HTTP Streaming)</option>
                </select>
              </ConfigField>

              {form.type === "stdio" ? (
                <>
                  <ConfigField label={t("mcp.command")}>
                    <input
                      type="text"
                      value={form.command}
                      onChange={(e) => setForm({ ...form, command: e.target.value })}
                      placeholder={t("mcp.commandPlaceholder")}
                      style={{
                        width: "100%",
                        height: 32,
                        fontSize: 13,
                        padding: "0 10px",
                        fontFamily: "var(--font-mono)",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        outline: "none",
                      }}
                    />
                  </ConfigField>

                  <ConfigField label={t("mcp.args")}>
                    <textarea
                      rows={3}
                      value={form.argsText}
                      onChange={(e) => setForm({ ...form, argsText: e.target.value })}
                      placeholder={t("mcp.argsPlaceholder")}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        padding: "6px 10px",
                        fontFamily: "var(--font-mono)",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                  </ConfigField>

                  <ConfigField label={t("mcp.env")}>
                    <textarea
                      rows={3}
                      value={form.envText}
                      onChange={(e) => setForm({ ...form, envText: e.target.value })}
                      placeholder={t("mcp.envPlaceholder")}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        padding: "6px 10px",
                        fontFamily: "var(--font-mono)",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                  </ConfigField>
                </>
              ) : (
                <ConfigField label={t("mcp.url")}>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder={t("mcp.urlPlaceholder")}
                    style={{
                      width: "100%",
                      height: 32,
                      fontSize: 13,
                      padding: "0 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                    }}
                  />
                </ConfigField>
              )}

              <ConfigField label={t("mcp.descriptionField")}>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t("mcp.descriptionPlaceholder")}
                  style={{
                    width: "100%",
                    height: 32,
                    fontSize: 13,
                    padding: "0 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    outline: "none",
                  }}
                />
              </ConfigField>
            </ConfigDetailStack>
          )}
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter
        status={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {statusMessage && (
              <span style={{ color: "var(--accent)", fontSize: 12 }}>
                {statusMessage}
              </span>
            )}
            {testResult && (
              <span
                style={{
                  fontSize: 12,
                  color: testResult.ok ? "#10b981" : "#ef4444",
                }}
              >
                {testResult.message}
              </span>
            )}
          </div>
        }
      >
        {form && (
          <>
            <ConfigButton
              variant="secondary"
              disabled={testing}
              onClick={() => void handleTestConnection()}
            >
              {testing ? t("mcp.testing") : t("mcp.test")}
            </ConfigButton>
            <ConfigButton
              variant="primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? t("mcp.saving") : t("mcp.save")}
            </ConfigButton>
          </>
        )}
        {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
      </ConfigFooter>
    </ConfigPanelShell>
  );
}
