"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon } from "./ProviderIcon";

export interface OverviewModel {
  id: string;
  name: string;
}

export interface ProviderGroup {
  provider: string;
  models: OverviewModel[];
}

interface Props {
  cwd: string | null;
  currentModel?: { provider: string; modelId: string } | null;
  onSelectModel?: (provider: string, modelId: string) => void;
  onFilterSaved?: () => void;
  onClose: () => void;
}

type StatusFilter = "all" | "enabled" | "disabled" | "current";

export function ProviderModelOverview({
  cwd,
  currentModel,
  onSelectModel,
  onFilterSaved,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [grouped, setGrouped] = useState<ProviderGroup[]>([]);
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] =
    useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<string | null>(null);

  const endpoint = cwd
    ? `/api/models/filter?cwd=${encodeURIComponent(cwd)}`
    : "/api/models/filter";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(endpoint, { cache: "no-store" })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              allModels: { id: string; name: string; provider: string }[];
              enabledModels: string[];
              defaultModel: { provider: string; modelId: string } | null;
            }>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, OverviewModel[]>();
        for (const m of data.allModels ?? []) {
          const list = map.get(m.provider) ?? [];
          list.push({ id: m.id, name: m.name || m.id });
          map.set(m.provider, list);
        }
        const groups = Array.from(map.entries())
          .map(([provider, models]) => ({
            provider,
            models: models.sort(
              (a, b) =>
                a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
            ),
          }))
          .sort((a, b) => a.provider.localeCompare(b.provider));
        setGrouped(groups);
        setDefaultModel(data.defaultModel ?? null);

        // If enabledModels is empty or undefined, initially all models are enabled
        const rawPatterns = data.enabledModels ?? [];
        const enabled = new Set<string>();

        if (rawPatterns.length === 0) {
          // All models enabled by default
          for (const m of data.allModels ?? []) {
            enabled.add(`${m.provider}:${m.id}`);
          }
        } else {
          for (const pattern of rawPatterns) {
            if (pattern.endsWith("/*")) {
              const prov = pattern.slice(0, -2);
              for (const m of data.allModels ?? []) {
                if (m.provider === prov) enabled.add(`${m.provider}:${m.id}`);
              }
            } else if (pattern.includes("/")) {
              const slash = pattern.indexOf("/");
              const prov = pattern.slice(0, slash);
              const id = pattern.slice(slash + 1).replace(/:.*$/, "");
              enabled.add(`${prov}:${id}`);
            } else {
              const id = pattern.replace(/:.*$/, "");
              for (const m of data.allModels ?? []) {
                if (m.id === id) enabled.add(`${m.provider}:${m.id}`);
              }
            }
          }
        }
        setEnabledKeys(enabled);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const allProviders = useMemo(() => grouped.map((g) => g.provider), [grouped]);
  const totalModelCount = useMemo(
    () => grouped.reduce((sum, g) => sum + g.models.length, 0),
    [grouped],
  );
  const totalEnabledCount = enabledKeys.size;

  const isCurrentModel = (provider: string, id: string) =>
    currentModel?.provider === provider && currentModel?.modelId === id;

  const isDefaultModel = (provider: string, id: string) =>
    defaultModel?.provider === provider && defaultModel?.modelId === id;

  const isModelEnabled = (provider: string, id: string) =>
    enabledKeys.has(`${provider}:${id}`);

  // Filter groups and models based on searchQuery, provider filter, and status filter
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const curProv = currentModel?.provider;
    const curId = currentModel?.modelId;

    return grouped
      .filter((group) => {
        if (
          selectedProviderFilter !== "all" &&
          group.provider !== selectedProviderFilter
        ) {
          return false;
        }
        return true;
      })
      .map((group) => {
        const providerMatch =
          !query || group.provider.toLowerCase().includes(query);

        const filteredModels = group.models.filter((m) => {
          const isCur = curProv === group.provider && curId === m.id;
          const isEn = enabledKeys.has(`${group.provider}:${m.id}`);

          // Status filter check
          if (statusFilter === "current" && !isCur) return false;
          if (statusFilter === "enabled" && !isEn) return false;
          if (statusFilter === "disabled" && isEn) return false;

          // Text query check
          if (!query) return true;
          if (providerMatch) return true;
          return (
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
          );
        });

        return {
          provider: group.provider,
          models: filteredModels,
        };
      })
      .filter((group) => group.models.length > 0);
  }, [
    grouped,
    searchQuery,
    selectedProviderFilter,
    statusFilter,
    enabledKeys,
    currentModel?.provider,
    currentModel?.modelId,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedProviderFilter !== "all" ||
    statusFilter !== "all";

  const toggleGroup = (provider: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allProviders));

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedProviderFilter("all");
    setStatusFilter("all");
  };

  // Toggle single model enable/disable
  const toggleModelEnabled = (provider: string, id: string) => {
    const key = `${provider}:${id}`;
    setEnabledKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaveSuccess(false);
  };

  // Toggle all models under a provider
  const toggleProviderEnabled = (provider: string) => {
    const group = grouped.find((g) => g.provider === provider);
    if (!group) return;
    const allEn = group.models.every((m) =>
      enabledKeys.has(`${provider}:${m.id}`),
    );

    setEnabledKeys((prev) => {
      const next = new Set(prev);
      for (const m of group.models) {
        const key = `${provider}:${m.id}`;
        if (allEn) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setSaveSuccess(false);
  };

  // Enable all models
  const enableAllModels = () => {
    const all = new Set<string>();
    for (const g of grouped) {
      for (const m of g.models) {
        all.add(`${g.provider}:${m.id}`);
      }
    }
    setEnabledKeys(all);
    setSaveSuccess(false);
  };

  // Disable all models
  const disableAllModels = () => {
    setEnabledKeys(new Set());
    setSaveSuccess(false);
  };

  // Save enabledModels filter to settings.json
  const saveFilter = async () => {
    setSaving(true);
    setError(null);
    try {
      // Build patterns: if all models enabled, send null (unrestricted); otherwise send exact provider/modelId list
      const isAll = totalModelCount > 0 && enabledKeys.size === totalModelCount;
      const patterns = isAll
        ? null
        : Array.from(enabledKeys).map((k) => {
            const [p, id] = k.split(":");
            return `${p}/${id}`;
          });

      const res = await fetch("/api/models/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: cwd || undefined,
          enabledModels: patterns,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(
          (d as { error?: string }).error || `HTTP ${res.status}`,
        );
      }

      setSaveSuccess(true);
      onFilterSaved?.();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (provider: string, modelId: string) => {
    if (!onSelectModel) return;
    onSelectModel(provider, modelId);
    const key = `${provider}:${modelId}`;
    setSelectedFeedback(key);
    setTimeout(() => {
      setSelectedFeedback((cur) => (cur === key ? null : cur));
    }, 1500);
  };

  const handleCopy = async (id: string) => {
    try {
      await navigator.clipboard?.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div
      className="config-dialog-backdrop settings-dialog-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "36px 16px",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("models.overview")}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 20px 64px rgba(0,0,0,0.38)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}
              >
                {t("models.overview")}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 10,
                  background:
                    totalEnabledCount < totalModelCount
                      ? "var(--bg-selected, rgba(59, 130, 246, 0.15))"
                      : "var(--bg)",
                  border: "1px solid var(--border)",
                  color:
                    totalEnabledCount < totalModelCount
                      ? "var(--accent)"
                      : "var(--text-dim)",
                  fontWeight: 600,
                }}
              >
                已启用 {totalEnabledCount} / {totalModelCount}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t("models.filterDropdownHint") ??
                "勾选的模型将显示在交互窗口的模型下拉菜单中"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("i18n.close")}
            title={t("i18n.close")}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 18,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            ×
          </button>
        </div>

        {/* Filter Controls Toolbar */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Search Box */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              width: "100%",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: "absolute",
                left: 10,
                color: "var(--text-dim)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchQuery) {
                  e.stopPropagation();
                  setSearchQuery("");
                }
              }}
              placeholder={
                t("models.overviewSearchPlaceholder") ?? "搜索模型或 Provider…"
              }
              style={{
                width: "100%",
                height: 32,
                padding: "0 30px 0 32px",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12.5,
                color: "var(--text)",
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                title="Clear"
                style={{
                  position: "absolute",
                  right: 8,
                  background: "none",
                  border: "none",
                  padding: 0,
                  width: 18,
                  height: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 13,
                  borderRadius: 3,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Pills & Quick Actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {/* Provider Selector Dropdown */}
              <select
                value={selectedProviderFilter}
                onChange={(e) => setSelectedProviderFilter(e.target.value)}
                style={{
                  height: 26,
                  padding: "0 8px",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  fontSize: 11.5,
                  color: "var(--text)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">
                  {t("models.overviewFilterAll") ?? "全部 Provider"}
                </option>
                {allProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              {/* Status Filter Buttons */}
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: 1,
                }}
              >
                {(["all", "enabled", "disabled", "current"] as const).map(
                  (s) => {
                    const active = statusFilter === s;
                    const label =
                      s === "all"
                        ? "全部"
                        : s === "enabled"
                          ? "已启用"
                          : s === "disabled"
                            ? "已禁用"
                            : "当前";
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        style={{
                          padding: "2px 8px",
                          fontSize: 11,
                          background: active
                            ? "var(--bg-selected, var(--bg-hover))"
                            : "none",
                          color: active ? "var(--text)" : "var(--text-muted)",
                          fontWeight: active ? 600 : 400,
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  },
                )}
              </div>

              {/* Quick Enable/Disable buttons */}
              <button
                type="button"
                onClick={enableAllModels}
                style={{
                  padding: "2px 6px",
                  fontSize: 11,
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("models.filterEnableAll") ?? "全部启用"}
              </button>
              <button
                type="button"
                onClick={disableAllModels}
                style={{
                  padding: "2px 6px",
                  fontSize: 11,
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {t("models.filterDisableAll") ?? "全部禁用"}
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  style={{
                    padding: "2px 6px",
                    fontSize: 11,
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    cursor: "pointer",
                  }}
                >
                  {t("models.overviewClearFilter") ?? "清空筛选"}
                </button>
              )}
            </div>

            {/* Expand / Collapse all buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={expandAll}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-dim)";
                }}
              >
                {t("models.overviewExpandAll") ?? "全部展开"}
              </button>
              <span style={{ color: "var(--border)" }}>|</span>
              <button
                type="button"
                onClick={collapseAll}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-dim)";
                }}
              >
                {t("models.overviewCollapseAll") ?? "全部折叠"}
              </button>
            </div>
          </div>
        </div>

        {/* Model Groups List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {loading && (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                fontSize: 12.5,
                color: "var(--text-dim)",
              }}
            >
              正在加载模型列表…
            </div>
          )}

          {!loading && error && (
            <div
              role="alert"
              style={{
                padding: "16px 18px",
                margin: "10px 18px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                fontSize: 12.5,
                color: "#f87171",
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && filteredGroups.length === 0 && (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {hasActiveFilters
                  ? (t("models.overviewNoMatches") ?? "未找到匹配的模型")
                  : "没有配置的模型。"}
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  style={{
                    padding: "4px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("models.overviewClearFilter") ?? "清空筛选"}
                </button>
              )}
            </div>
          )}

          {!loading &&
            !error &&
            filteredGroups.map((group) => {
              const isCollapsed = collapsed.has(group.provider);
              const groupAllEnabled =
                group.models.length > 0 &&
                group.models.every((m) =>
                  enabledKeys.has(`${group.provider}:${m.id}`),
                );
              const groupSomeEnabled = group.models.some((m) =>
                enabledKeys.has(`${group.provider}:${m.id}`),
              );

              return (
                <div
                  key={group.provider}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  {/* Provider Group Header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 18px",
                      background: "var(--bg-panel)",
                      userSelect: "none",
                    }}
                  >
                    {/* Provider check/uncheck all checkbox */}
                    <input
                      type="checkbox"
                      checked={groupAllEnabled}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            groupSomeEnabled && !groupAllEnabled;
                      }}
                      onChange={() => toggleProviderEnabled(group.provider)}
                      title={`启用/禁用 ${group.provider} 下的所有模型`}
                      style={{
                        cursor: "pointer",
                        width: 15,
                        height: 15,
                        accentColor: "var(--accent)",
                      }}
                    />

                    <div
                      onClick={() => toggleGroup(group.provider)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                      }}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="var(--text-dim)"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          flexShrink: 0,
                          transform: isCollapsed ? "none" : "rotate(90deg)",
                          transition: "transform 0.1s",
                        }}
                      >
                        <polyline points="3 2 7 5 3 8" />
                      </svg>
                      <ProviderIcon id={group.provider} size={16} />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.provider}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "1px 6px",
                          borderRadius: 8,
                          background: "var(--bg)",
                          color: "var(--text-dim)",
                        }}
                      >
                        {
                          group.models.filter((m) =>
                            enabledKeys.has(`${group.provider}:${m.id}`),
                          ).length
                        }{" "}
                        / {group.models.length}
                      </span>
                    </div>
                  </div>

                  {/* Model Rows in this Provider */}
                  {!isCollapsed && (
                    <div style={{ background: "var(--bg)" }}>
                      {group.models.map((m) => {
                        const enabled = isModelEnabled(group.provider, m.id);
                        const cur = isCurrentModel(group.provider, m.id);
                        const def = isDefaultModel(group.provider, m.id);
                        const isFeedback =
                          selectedFeedback === `${group.provider}:${m.id}`;

                        return (
                          <div
                            key={m.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "7px 18px 7px 24px",
                              borderTop: "1px solid var(--border)",
                              background: cur
                                ? "var(--bg-selected, rgba(59, 130, 246, 0.06))"
                                : "transparent",
                              opacity: enabled ? 1 : 0.45,
                              transition: "background 0.12s, opacity 0.12s",
                            }}
                            onMouseEnter={(e) => {
                              if (!cur)
                                e.currentTarget.style.background =
                                  "var(--bg-hover)";
                            }}
                            onMouseLeave={(e) => {
                              if (!cur)
                                e.currentTarget.style.background =
                                  "transparent";
                            }}
                          >
                            {/* Enable/Disable Checkbox */}
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() =>
                                toggleModelEnabled(group.provider, m.id)
                              }
                              title={
                                enabled
                                  ? "点击取消勾选（将不在交互下拉菜单中显示）"
                                  : "点击勾选（将在交互下拉菜单中显示）"
                              }
                              style={{
                                cursor: "pointer",
                                width: 15,
                                height: 15,
                                accentColor: "var(--accent)",
                              }}
                            />

                            {/* Model Info */}
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: 1,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: cur ? 600 : 500,
                                    color: cur
                                      ? "var(--accent)"
                                      : "var(--text)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {m.name}
                                </span>
                                {cur && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                      background: "var(--accent)",
                                      color: "#fff",
                                      fontWeight: 600,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {t("models.overviewSelected") ?? "当前使用"}
                                  </span>
                                )}
                                {def && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                      background: "var(--bg-panel)",
                                      border: "1px solid var(--border)",
                                      color: "var(--text-muted)",
                                      fontWeight: 500,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {t("models.overviewDefault") ?? "默认"}
                                  </span>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-dim)",
                                  fontFamily: "var(--font-mono)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {m.id}
                              </span>
                            </div>

                            {/* Actions: Select & Copy */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexShrink: 0,
                              }}
                            >
                              {onSelectModel && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelect(group.provider, m.id)
                                  }
                                  disabled={cur}
                                  title={
                                    cur ? "当前已选模型" : `切换为 ${m.name}`
                                  }
                                  style={{
                                    padding: "3px 10px",
                                    fontSize: 11.5,
                                    fontWeight: 500,
                                    borderRadius: 5,
                                    border: cur
                                      ? "1px solid transparent"
                                      : "1px solid var(--border)",
                                    background: isFeedback
                                      ? "#4ade80"
                                      : cur
                                        ? "none"
                                        : "var(--bg-panel)",
                                    color: isFeedback
                                      ? "#000"
                                      : cur
                                        ? "var(--accent)"
                                        : "var(--text)",
                                    cursor: cur ? "default" : "pointer",
                                    transition: "all 0.12s",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!cur && !isFeedback) {
                                      e.currentTarget.style.background =
                                        "var(--bg-hover)";
                                      e.currentTarget.style.borderColor =
                                        "var(--text-dim)";
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!cur && !isFeedback) {
                                      e.currentTarget.style.background =
                                        "var(--bg-panel)";
                                      e.currentTarget.style.borderColor =
                                        "var(--border)";
                                    }
                                  }}
                                >
                                  {isFeedback
                                    ? "已选择 ✓"
                                    : cur
                                      ? "✓ 当前"
                                      : (t("models.overviewSelect") ?? "选择")}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleCopy(m.id)}
                                title={
                                  t("models.overviewCopy") ?? "复制模型 ID"
                                }
                                style={{
                                  padding: "3px 7px",
                                  fontSize: 11,
                                  borderRadius: 5,
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-panel)",
                                  color:
                                    copiedId === m.id
                                      ? "#4ade80"
                                      : "var(--text-dim)",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = "var(--text)";
                                }}
                                onMouseLeave={(e) => {
                                  if (copiedId !== m.id)
                                    e.currentTarget.style.color =
                                      "var(--text-dim)";
                                }}
                              >
                                {copiedId === m.id ? "已复制" : "复制"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Footer: Save & Apply Button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {saveSuccess ? (
              <span style={{ color: "#4ade80", fontWeight: 600 }}>
                ✓ {t("models.filterSaved") ?? "已保存并应用！"}
              </span>
            ) : (
              <span>
                已勾选 <strong>{totalEnabledCount}</strong> 个模型显示在交互窗口
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 14px",
                fontSize: 12.5,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("i18n.cancel") ?? "取消"}
            </button>
            <button
              type="button"
              onClick={saveFilter}
              disabled={saving}
              style={{
                padding: "6px 16px",
                fontSize: 12.5,
                fontWeight: 600,
                background: "var(--accent)",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving
                ? (t("models.filterSaving") ?? "保存中…")
                : (t("models.filterSave") ?? "保存并应用")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
