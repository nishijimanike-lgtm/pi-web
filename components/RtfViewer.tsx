"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileExt, RTF_PREVIEW_MAX_BYTES } from "@/lib/file-types";
import { fileVersion, fileVersionChanged } from "@/lib/file-version";
import { getFileApiUrl, getFileName, getRelativeFilePath } from "@/lib/file-paths";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  watchEnabled?: boolean;
}

type DisplayMode = "preview" | "source";

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

export function RtfViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const ext = getFileExt(filePath);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [displayMode, setDisplayMode] = useState<DisplayMode>("preview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const [rawText, setRawText] = useState<string>("");
  const [renderedElements, setRenderedElements] = useState<HTMLElement[] | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const loadRequestRef = useRef(0);
  const shownVersionRef = useRef<string | null>(null);

  const loadRtf = useCallback((filePath: string) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);

    fetch(getFileApiUrl(filePath, "download", sourceSessionId))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        if (requestId !== loadRequestRef.current) return null;

        // Save raw text representation for source view
        try {
          const text = new TextDecoder("utf-8").decode(arrayBuffer);
          setRawText(text);
        } catch {
          // Ignore decoding issues for source view
        }

        if (arrayBuffer.byteLength > RTF_PREVIEW_MAX_BYTES) {
          throw new Error(`RTF file too large for preview (>${RTF_PREVIEW_MAX_BYTES / 1024 / 1024}MB)`);
        }

        // Lazy-load rtf.js on demand
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rtfModule: any = await import("rtf.js/dist/RTFJS.bundle.js");
        const RTFJS = rtfModule.RTFJS || rtfModule.default?.RTFJS || rtfModule.default || rtfModule;
        if (typeof RTFJS.loggingEnabled === "function") {
          RTFJS.loggingEnabled(false);
        }

        const DocClass = RTFJS.Document || rtfModule.Document || rtfModule.default?.Document;
        if (!DocClass) {
          throw new Error("Failed to load RTF Document class");
        }

        const doc = new DocClass(arrayBuffer);
        const htmlElements: HTMLElement[] = await doc.render();

        return htmlElements;
      })
      .then((elements) => {
        if (!elements || requestId !== loadRequestRef.current) return;
        setRenderedElements(elements);
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
          for (const el of elements) {
            containerRef.current.appendChild(el);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (requestId !== loadRequestRef.current) return;
        setError(String(err?.message ?? err));
        setLoading(false);
      });
  }, [sourceSessionId]);

  // Keep the DOM populated whenever renderedElements or displayMode updates
  useEffect(() => {
    if (displayMode === "preview" && containerRef.current && renderedElements) {
      containerRef.current.innerHTML = "";
      for (const el of renderedElements) {
        containerRef.current.appendChild(el);
      }
    }
  }, [displayMode, renderedElements]);

  useEffect(() => {
    shownVersionRef.current = null;
    loadRtf(filePath);

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number }) => {
        if (typeof d.size === "number") setSize(d.size);
      })
      .catch(() => {});
  }, [filePath, sourceSessionId, loadRtf]);

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
      loadRtf(filePath);
    });

    const markDisconnected = () => setWatching(false);
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled, loadRtf]);

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

        {/* Display Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 8 }}>
          <button
            type="button"
            className="file-viewer-mode-button"
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: displayMode === "preview" ? "var(--bg-selected)" : "transparent",
              color: displayMode === "preview" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
            }}
            onClick={() => setDisplayMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className="file-viewer-mode-button"
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: displayMode === "source" ? "var(--bg-selected)" : "transparent",
              color: displayMode === "source" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
            }}
            onClick={() => setDisplayMode("source")}
          >
            Source
          </button>
        </div>

        <span style={{ marginLeft: "auto" }}>{ext || "rtf preview"}</span>
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

      {/* Main Content Area */}
      {displayMode === "source" ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: "var(--bg)",
            padding: 16,
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {rawText}
          </pre>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: "var(--bg-panel)",
            padding: 24,
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "flex-start",
          }}
        >
          {loading && (
            <div style={{ margin: "auto", color: "var(--text-dim)", fontSize: 13 }}>
              Loading RTF document...
            </div>
          )}
          {error && !loading && (
            <div style={{ margin: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "#f87171", fontSize: 13, textAlign: "center", padding: 24 }}>
              <div>{error}</div>
              <button
                type="button"
                className="file-viewer-mode-button"
                style={{
                  padding: "4px 12px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
                onClick={() => setDisplayMode("source")}
              >
                View Raw RTF
              </button>
            </div>
          )}
          <div
            ref={containerRef}
            className="rtf-preview-document"
            style={{
              display: loading || error ? "none" : "block",
              width: "fit-content",
              minWidth: "min(100%, 720px)",
              maxWidth: "100%",
              margin: "0 auto",
              background: "#ffffff",
              color: "#1f2937",
              padding: "40px 48px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
              borderRadius: 4,
              fontSize: 14,
              lineHeight: 1.6,
              boxSizing: "border-box",
              overflowWrap: "break-word",
            }}
          />
        </div>
      )}
    </div>
  );
}
