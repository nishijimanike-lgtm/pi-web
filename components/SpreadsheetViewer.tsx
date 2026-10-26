"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DelimitedTable } from "@/components/DelimitedTable";
import { useI18n } from "@/hooks/useI18n";
import { type DelimitedTableData } from "@/lib/delimited-table";
import { getFileExt, SPREADSHEET_PREVIEW_MAX_BYTES } from "@/lib/file-types";
import { fileVersion, fileVersionChanged } from "@/lib/file-version";
import { getFileApiUrl, getFileName, getRelativeFilePath } from "@/lib/file-paths";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  watchEnabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadButton({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

export function SpreadsheetViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const ext = getFileExt(filePath);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [sheetsData, setSheetsData] = useState<Record<string, DelimitedTableData>>({});
  const [watching, setWatching] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const loadRequestRef = useRef(0);
  const shownVersionRef = useRef<string | null>(null);

  const loadSpreadsheet = useCallback((filePath: string) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);

    fetch(getFileApiUrl(filePath, "download", sourceSessionId))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        if (requestId !== loadRequestRef.current) return null;

        if (arrayBuffer.byteLength > SPREADSHEET_PREVIEW_MAX_BYTES) {
          throw new Error(`Spreadsheet too large for preview (>${SPREADSHEET_PREVIEW_MAX_BYTES / 1024 / 1024}MB)`);
        }

        // Lazy-load xlsx on demand
        const XLSX = await import("xlsx");
        const wb = XLSX.read(arrayBuffer, { type: "array" });
        const parsedSheets: Record<string, DelimitedTableData> = {};

        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name];
          if (!sheet) continue;
          const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          if (rawRows.length === 0) {
            parsedSheets[name] = {
              columns: ["Column 1"],
              headerLine: 1,
              rows: [],
              rowLines: [],
            };
            continue;
          }

          const maxCols = rawRows.reduce<number>((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0);
          const colCount = Math.max(1, maxCols);

          const headerRow = Array.isArray(rawRows[0]) ? rawRows[0] : [];
          const columns: string[] = [];
          for (let c = 0; c < colCount; c += 1) {
            const rawVal = headerRow[c];
            columns.push(rawVal != null && String(rawVal).trim() !== "" ? String(rawVal) : `Col ${c + 1}`);
          }

          const rows: string[][] = [];
          const rowLines: number[] = [];
          for (let r = 1; r < rawRows.length; r += 1) {
            const rowData = rawRows[r];
            const cells: string[] = [];
            for (let c = 0; c < colCount; c += 1) {
              const val = Array.isArray(rowData) ? rowData[c] : "";
              cells.push(val != null ? String(val) : "");
            }
            rows.push(cells);
            rowLines.push(r + 1);
          }

          parsedSheets[name] = {
            columns,
            headerLine: 1,
            rows,
            rowLines,
          };
        }

        return {
          names: wb.SheetNames,
          parsed: parsedSheets,
        };
      })
      .then((result) => {
        if (!result || requestId !== loadRequestRef.current) return;
        setSheetsData(result.parsed);
        setSheetNames(result.names);
        setActiveSheet((prev) => (result.names.includes(prev) ? prev : result.names[0] ?? ""));
        setLoading(false);
      })
      .catch((err) => {
        if (requestId !== loadRequestRef.current) return;
        setError(String(err?.message ?? err));
        setLoading(false);
      });
  }, [sourceSessionId]);

  useEffect(() => {
    shownVersionRef.current = null;
    loadSpreadsheet(filePath);

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number }) => {
        if (typeof d.size === "number") setSize(d.size);
      })
      .catch(() => {});
  }, [filePath, sourceSessionId, loadSpreadsheet]);

  useEffect(() => {
    setWatching(false);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (!watchEnabled) return;

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        const version = fileVersion(d);
        if (!fileVersionChanged(shownVersionRef.current, version)) return;
        shownVersionRef.current = version;
        if (typeof d.size === "number") setSize(d.size);
      } catch {
        // ignore
      }
      loadSpreadsheet(filePath);
    });

    const markDisconnected = () => setWatching(false);
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled, loadSpreadsheet]);

  const currentTableData = sheetsData[activeSheet];
  const rowCount = currentTableData?.rows.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Top Header Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "spreadsheet"}</span>
        {sheetNames.length > 0 && (
          <span>
            {sheetNames.length} {sheetNames.length === 1 ? "sheet" : "sheets"}
          </span>
        )}
        {rowCount > 0 && (
          <span>
            {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
          </span>
        )}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadButton filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>

      {/* Sheet Tabs Bar (if multiple sheets exist) */}
      {sheetNames.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 12px",
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {sheetNames.map((name) => {
            const isSelected = activeSheet === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setActiveSheet(name)}
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  borderRadius: 4,
                  border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: isSelected ? "var(--bg-selected)" : "var(--bg)",
                  color: isSelected ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontWeight: isSelected ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Table Content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          position: "relative",
        }}
      >
        {loading ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
            Loading spreadsheet...
          </div>
        ) : error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : currentTableData && currentTableData.columns.length > 0 ? (
          <DelimitedTable
            tableData={currentTableData}
            scrollRef={scrollRef}
          />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
            Empty sheet
          </div>
        )}
      </div>
    </div>
  );
}
