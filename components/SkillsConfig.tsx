"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
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
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function orderSkillsByDormancy<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[]): T[] {
  return [
    ...skills.filter((skill) => !skill.disableModelInvocation),
    ...skills.filter((skill) => skill.disableModelInvocation),
  ];
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <ConfigDetailStack>
      {/* Path + tag + toggle, with a stable status row below. */}
      <div className="skill-detail-heading">
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <span className={`config-scope-tag${label === "project" ? " is-project" : ""}`}>
              {label}
            </span>
            <span className="config-detail-path">
              {displayPath(skill.filePath)}
            </span>
          </ConfigDetailHeaderInfo>
          <ConfigDetailActions>
            <ConfigSwitch
              checked={enabled}
              loading={toggling}
              label={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
              onChange={() => onToggle(skill)}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        <div className="skill-detail-status-row">
          {!enabled && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {skill.disabledByFile
                ? t("i18n.disabledByFileRename")
                : t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: 12, color: "#f87171", overflowWrap: "anywhere" }}>
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <ConfigField label="Source">
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            className="skill-source-link"
          >
            <span className="skill-source-link-text">
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </ConfigField>
      )}

      {skill.install && (
        <ConfigField label="Version">
          <div className="skill-version-row">
            <span className="skill-version-value">
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <ConfigButton
                size="small"
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
              >
                 {t("i18n.check")}
              </ConfigButton>
            )}
            {updateStatus?.state === "update-available" && (
              <span className="skill-version-value is-update">
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                className={`skill-update-status ${checkingUpdate
                  ? "is-checking"
                  : updateStatus?.state === "up-to-date"
                    ? "is-success"
                    : updateStatus?.state === "error"
                      ? "is-error"
                      : "is-muted"}`}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <ConfigButton
                variant="primary"
                size="small"
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </ConfigButton>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{updateError}</span>
          )}
        </ConfigField>
      )}

      <ConfigField label="Name">
        <span className="skill-name-value">
          {skill.name}
        </span>
      </ConfigField>

      <ConfigField label="Description">
        <span className="skill-description">
          {skill.description}
        </span>
      </ConfigField>
    </ConfigDetailStack>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const res = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setSearchError("No skills found");
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <ConfigDetailStack className="is-full-height">
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <ConfigDetailTitle>{t("i18n.addSkill")}</ConfigDetailTitle>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
             placeholder={t("i18n.skillSearchPlaceholder")}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              outline: "none",
            }}
          />
          <ConfigButton
            variant="primary"
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
          >
             {searching ? t("i18n.searching") : t("i18n.search")}
          </ConfigButton>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "global" || projectResourcesLoaded) setScope(s);
                }}
                disabled={s === "project" && !projectResourcesLoaded}
                title={s === "project" && !projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: s === "project" && !projectResourcesLoaded ? "not-allowed" : "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  opacity: s === "project" && !projectResourcesLoaded ? 0.45 : 1,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: 12, color: "#f87171" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 3,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <ConfigButton
                  size="small"
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled
                      ? "#16a34a"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                >
                  {isInstalled
                     ? `✓ ${t("i18n.installed")}`
                    : isInstalling
                       ? t("i18n.installing")
                       : t("i18n.install")}
                </ConfigButton>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}
          >
            Search{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              skills.sh
            </a>{" "}
            to discover and install skills for your agent.
          </div>
        )
      )}
    </ConfigDetailStack>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("skills", cwd));
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "project" | "global" | "path">("all");
  const [batchUpdating, setBatchUpdating] = useState(false);
  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        if (current && list.some((skill) => skill.filePath === current)) return current;
        const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
        return initialSkill?.filePath ?? null;
      });
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected) setLastSettingsSelection("skills", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
      // A file-disabled skill (SKILL.md.disabled) is renamed to SKILL.md on enable,
      // so its filePath changes; refresh the list to pick up the new path.
      if (skill.disabledByFile && !next) await loadSkills();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, [loadSkills]);
  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return skills.filter((skill) => {
      if (statusFilter === "enabled" && skill.disableModelInvocation) return false;
      if (statusFilter === "disabled" && !skill.disableModelInvocation) return false;

      const scope = sourceLabel(skill);
      if (scopeFilter !== "all" && scope !== scopeFilter) return false;

      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        (skill.description && skill.description.toLowerCase().includes(q)) ||
        skill.filePath.toLowerCase().includes(q) ||
        (skill.install?.package && skill.install.package.toLowerCase().includes(q))
      );
    });
  }, [skills, searchQuery, statusFilter, scopeFilter]);

  const totalSkillsCount = skills.length;
  const enabledSkillsCount = skills.filter((s) => !s.disableModelInvocation).length;
  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== "all" || scopeFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setScopeFilter("all");
  };

  const batchToggle = useCallback(async (targetSkills: Skill[], disable: boolean) => {
    const needUpdate = targetSkills.filter((s) => Boolean(s.disableModelInvocation) !== disable);
    if (needUpdate.length === 0) return;

    setBatchUpdating(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: needUpdate.map((s) => ({
            filePath: s.filePath,
            disableModelInvocation: disable,
          })),
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      const updatedPaths = new Set(needUpdate.map((s) => s.filePath));
      setSkills((prev) =>
        prev.map((s) => (updatedPaths.has(s.filePath) ? { ...s, disableModelInvocation: disable } : s)),
      );
      // Enabling a file-disabled skill renames SKILL.md.disabled -> SKILL.md, so the
      // filePath changes; refresh the list to pick up the new paths.
      if (needUpdate.some((s) => s.disabledByFile && !disable)) await loadSkills();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setBatchUpdating(false);
    }
  }, [loadSkills]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>
        {!projectResourcesLoaded && (
          <div role="status" className="config-trust-notice">
            {t("trust.skillsNotLoaded")}
          </div>
        )}

        {/* Body */}
        <ConfigSplitView>
          {/* Left: skill list */}
          <ConfigSidebar>
            {/* Top Toolbar: Search, Filters, and Batch Controls */}
            <div
              style={{
                padding: "8px 8px 6px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "var(--bg-panel)",
                flexShrink: 0,
              }}
            >
              {/* Header Status & Count */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                  {t("common.skills")}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    padding: "1px 6px",
                    borderRadius: 8,
                    background: enabledSkillsCount < totalSkillsCount ? "var(--bg-selected, rgba(59, 130, 246, 0.12))" : "var(--bg)",
                    border: "1px solid var(--border)",
                    color: enabledSkillsCount < totalSkillsCount ? "var(--accent)" : "var(--text-dim)",
                    fontWeight: 600,
                  }}
                >
                  {t("skills.enabledCount", { enabled: enabledSkillsCount, total: totalSkillsCount })}
                </span>
              </div>

              {/* Search input */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ position: "absolute", left: 7, color: "var(--text-dim)", pointerEvents: "none" }}
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
                  placeholder={t("skills.searchPlaceholder") ?? "搜索技能…"}
                  style={{
                    width: "100%",
                    height: 26,
                    padding: "0 22px 0 24px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    fontSize: 11.5,
                    color: "var(--text)",
                    outline: "none",
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 5,
                      background: "none",
                      border: "none",
                      padding: 0,
                      width: 16,
                      height: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Filter Pills & Batch Action Toolbar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, flexWrap: "wrap" }}>
                {/* Status Filter (全部 / 已启用 / 已禁用) */}
                <div style={{ display: "flex", gap: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: 1 }}>
                  {(["all", "enabled", "disabled"] as const).map((s) => {
                    const active = statusFilter === s;
                    const label = s === "all" ? (t("skills.filterAll") ?? "全部") : s === "enabled" ? (t("skills.filterEnabled") ?? "已启用") : (t("skills.filterDisabled") ?? "已禁用");
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        style={{
                          padding: "1px 6px",
                          fontSize: 10.5,
                          background: active ? "var(--bg-selected, var(--bg-hover))" : "none",
                          color: active ? "var(--text)" : "var(--text-muted)",
                          fontWeight: active ? 600 : 400,
                          border: "none",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Batch Enable/Disable for visible list */}
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <button
                    type="button"
                    disabled={batchUpdating || filteredSkills.length === 0}
                    onClick={() => void batchToggle(filteredSkills, false)}
                    title={t("skills.enableAll") ?? "全部启用"}
                    style={{
                      padding: "1px 5px",
                      fontSize: 10.5,
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--accent)",
                      cursor: batchUpdating || filteredSkills.length === 0 ? "default" : "pointer",
                      opacity: batchUpdating || filteredSkills.length === 0 ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                  >
                    {t("skills.enableAll") ?? "全部启用"}
                  </button>
                  <button
                    type="button"
                    disabled={batchUpdating || filteredSkills.length === 0}
                    onClick={() => void batchToggle(filteredSkills, true)}
                    title={t("skills.disableAll") ?? "全部禁用"}
                    style={{
                      padding: "1px 5px",
                      fontSize: 10.5,
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text-muted)",
                      cursor: batchUpdating || filteredSkills.length === 0 ? "default" : "pointer",
                      opacity: batchUpdating || filteredSkills.length === 0 ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                  >
                    {t("skills.disableAll") ?? "全部禁用"}
                  </button>
                </div>
              </div>

              {/* Active Filters Clear Row */}
              {hasActiveFilters && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5 }}>
                  <span style={{ color: "var(--text-dim)" }}>
                    {filteredSkills.length} / {totalSkillsCount}
                  </span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent)",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 10.5,
                    }}
                  >
                    {t("skills.clearFilter") ?? "清空筛选"}
                  </button>
                </div>
              )}

              {/* Batch update loading banner */}
              {batchUpdating && (
                <div style={{ fontSize: 10.5, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{t("skills.batchUpdating") ?? "正在批量更新…"}</span>
                </div>
              )}
            </div>

            <ConfigSidebarList>
              {loading ? (
                <div className="config-sidebar-message">
                   {t("i18n.loading")}
                </div>
              ) : error ? (
                <div className="config-sidebar-message is-error">
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div className="config-sidebar-message is-empty">
                   {t("i18n.noSkills")}
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="config-sidebar-message is-empty" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", padding: "16px 8px" }}>
                  <span>{t("skills.noMatches") ?? "未找到匹配的技能"}</span>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      style={{
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontSize: 11,
                        color: "var(--accent)",
                        cursor: "pointer",
                      }}
                    >
                      {t("skills.clearFilter") ?? "清空筛选"}
                    </button>
                  )}
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof filteredSkills }[] = [];
                  const scopeLabels = {
                    project: t("skills.scope.project"),
                    global: t("skills.scope.global"),
                    path: t("skills.scope.path"),
                  };
                  const groupDefinitions = [
                    {
                      label: `${scopeLabels.project} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.project,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: `${scopeLabels.global} / skills.sh`,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: scopeLabels.global,
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: scopeLabels.path,
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = filteredSkills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      !addMode && selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <ConfigSidebarItem
                        key={skill.filePath}
                        active={isSelected}
                        onClick={() => {
                          setSelected(skill.filePath);
                          setAddMode(false);
                        }}
                      >
                        <ConfigStatusDot active={!disabled} />
                        <ConfigSidebarText className={`is-grow${disabled ? " is-muted" : ""}`}>
                          {skill.name}
                        </ConfigSidebarText>
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          return (
                            <span title={t("i18n.updateAvailable")} className="skill-update-indicator">
                              ↑
                            </span>
                          );
                        })()}
                      </ConfigSidebarItem>
                    );
                  };
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => {
                      const groupAllEnabled = grpSkills.every((s) => !s.disableModelInvocation);
                      return (
                        <div key={grpLabel} className="config-sidebar-group">
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 4 }}>
                            <ConfigSidebarGroupLabel>
                              {grpLabel}
                            </ConfigSidebarGroupLabel>
                            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                              <span style={{ fontSize: 10, color: "var(--text-dim)", marginRight: 2 }}>
                                {grpSkills.filter((s) => !s.disableModelInvocation).length}/{grpSkills.length}
                              </span>
                              <button
                                type="button"
                                disabled={batchUpdating}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void batchToggle(grpSkills, groupAllEnabled);
                                }}
                                title={groupAllEnabled ? (t("skills.disableAll") ?? "禁用该组") : (t("skills.enableAll") ?? "启用该组")}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: "1px 4px",
                                  fontSize: 10,
                                  color: groupAllEnabled ? "var(--text-muted)" : "var(--accent)",
                                  cursor: batchUpdating ? "default" : "pointer",
                                  borderRadius: 3,
                                  opacity: batchUpdating ? 0.5 : 1,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                              >
                                {groupAllEnabled ? (t("skills.disableAll") ?? "禁用") : (t("skills.enableAll") ?? "启用")}
                              </button>
                            </div>
                          </div>
                          {orderSkillsByDormancy(grpSkills).map(renderSkillRow)}
                        </div>
                      );
                    },
                  );
                })()
              )}
            </ConfigSidebarList>
            {/* Add skill button */}
            <ConfigListAction
                onClick={() => setAddMode(true)}
                active={addMode}
              >
                 {t("i18n.addSkill")}
            </ConfigListAction>
          </ConfigSidebar>

          {/* Right: detail or add panel */}
          <ConfigDetail>
            <ConfigDetailStack className="is-fill">
              {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                projectResourcesLoaded={projectResourcesLoaded}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
              />
              ) : (
                <ConfigEmptyState>{t("i18n.selectSkill")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>

        {/* Footer */}
        <ConfigFooter status={
            Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span style={{ fontSize: 12, color: "#d97706" }}>
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </span>
            )}
        >
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {skills.some((skill) => Boolean(skill.install)) && (
            <ConfigButton variant="secondary" onClick={() => void checkForUpdates()} disabled={checkingAll || updatingSkill !== null}>
              {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
        </ConfigFooter>
    </ConfigPanelShell>
  );
}
