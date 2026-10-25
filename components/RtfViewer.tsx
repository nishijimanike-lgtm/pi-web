"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileExt, RTF_PREVIEW_MAX_BYTES } from "@/lib/file-types";
import { fileVersion, fileVersionChanged } from "@/lib/file-version";
import { getFileApiUrl, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { extractRtfText } from "@/lib/rtf-extractor";

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
  const [isFallback, setIsFallback] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const [rawText, setRawText] = useState<string>("");
  const [extractedText, setExtractedText] = useState<string>("");
  const [renderedElements, setRenderedElements] = useState<HTMLElement[] | null>(null);

  const [openAppSupported, setOpenAppSupported] = useState(false);
  const [openAppLoading, setOpenAppLoading] = useState(false);
  const [openAppFeedback, setOpenAppFeedback] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const loadRequestRef = useRef(0);
  const shownVersionRef = useRef<string | null>(null);

  // Check if opening files in native system applications is supported (loopback / desktop)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => (res.ok ? (res.json() as Promise<{ supported?: boolean }>) : null))
      .then((data) => {
        if (!cancelled && data?.supported) {
          setOpenAppSupported(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenInSystemApp = useCallback(async () => {
    setOpenAppLoading(true);
    setOpenAppFeedback(null);
    try {
      const res = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (res.ok) {
        setOpenAppFeedback(t("i18n.openInDefaultAppSuccess"));
        setTimeout(() => setOpenAppFeedback(null), 3000);
      } else {
        setOpenAppFeedback(t("i18n.openInDefaultAppFailed"));
        setTimeout(() => setOpenAppFeedback(null), 4000);
      }
    } catch {
      setOpenAppFeedback(t("i18n.openInDefaultAppFailed"));
      setTimeout(() => setOpenAppFeedback(null), 4000);
    } finally {
      setOpenAppLoading(false);
    }
  }, [filePath, t]);

  const loadRtf = useCallback((filePath: string) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    setIsFallback(false);
    setRenderedElements(null);

    fetch(getFileApiUrl(filePath, "download", sourceSessionId))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        if (requestId !== loadRequestRef.current) return;

        // Decode text for source view and plain-text fallback extraction
        let text = "";
        try {
          text = new TextDecoder("utf-8").decode(arrayBuffer);
          setRawText(text);
          const extracted = extractRtfText(text);
          setExtractedText(extracted);
        } catch {
          // Ignore decoding issues
        }

        if (arrayBuffer.byteLength > RTF_PREVIEW_MAX_BYTES) {
          // If file is very large, fall back to extracted text directly
          setIsFallback(true);
          setLoading(false);
          return;
        }

        try {
          // Ensure window globals for WMFJS / EMFJS before evaluating RTFJS
          if (typeof window !== "undefined") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const win = window as any;
            if (!win.EMFJS) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const emf: any = await import("rtf.js/dist/EMFJS.bundle.js");
                win.EMFJS = emf.EMFJS || emf.default || emf;
              } catch {
                win.EMFJS = {};
              }
            }
            if (!win.WMFJS) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const wmf: any = await import("rtf.js/dist/WMFJS.bundle.js");
                win.WMFJS = wmf.WMFJS || wmf.default || wmf;
              } catch {
                win.WMFJS = {};
              }
            }
          }

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

          if (requestId !== loadRequestRef.current) return;
          setRenderedElements(htmlElements);
          setIsFallback(false);
          if (containerRef.current) {
            containerRef.current.innerHTML = "";
            for (const el of htmlElements) {
              containerRef.current.appendChild(el);
            }
          }
          setLoading(false);
        } catch (err) {
          if (requestId !== loadRequestRef.current) return;
          // Graceful fallback: when rtf.js encounters unsupported control words or tables,
          // switch to clean extracted text view instead of failing
          console.warn("[RtfViewer] rtf.js parsing fallback:", err);
          setIsFallback(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (requestId !== loadRequestRef.current) return;
        setError(String(err?.message ?? err));
        setLoading(false);
      });
  }, [sourceSessionId]);

  // Keep the DOM populated whenever renderedElements or displayMode updates
  useEffect(() => {
    if (displayMode === "preview" && !isFallback && containerRef.current && renderedElements) {
      containerRef.current.innerHTML = "";
      for (const el of renderedElements) {
        containerRef.current.appendChild(el);
      }
    }
  }, [displayMode, isFallback, renderedElements]);

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
            {t("i18n.preview")}
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
            {t("i18n.source")}
          </button>
        </div>

        {/* Action: Open in OS native app (Word / WordPad / TextEdit) */}
        {openAppSupported && (
          <button
            type="button"
            onClick={handleOpenInSystemApp}
            disabled={openAppLoading}
            title={t("i18n.openInDefaultApp")}
            className="file-viewer-mode-button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              cursor: openAppLoading ? "wait" : "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>{openAppLoading ? "..." : (openAppFeedback ?? t("i18n.openInDefaultApp"))}</span>
          </button>
        )}

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
            flexDirection: "column",
            alignItems: "center",
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
                {t("i18n.viewRawRtf")}
              </button>
            </div>
          )}

          {/* Complex RTF / Fallback Notice Banner */}
          {!loading && !error && isFallback && (
            <div
              style={{
                width: "min(100%, 780px)",
                margin: "0 auto 16px auto",
                padding: "10px 14px",
                borderRadius: 6,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 12,
                lineHeight: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-muted)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2, color: "#eab308" }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{t("i18n.rtfFallbackNotice")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 22 }}>
                {openAppSupported && (
                  <button
                    type="button"
                    onClick={handleOpenInSystemApp}
                    disabled={openAppLoading}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 10px",
                      fontSize: 11,
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--accent)",
                      color: "#ffffff",
                      cursor: openAppLoading ? "wait" : "pointer",
                      fontWeight: 500,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span>{openAppLoading ? "..." : (openAppFeedback ?? t("i18n.openInDefaultApp"))}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDisplayMode("source")}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {t("i18n.viewRawRtf")}
                </button>
              </div>
            </div>
          )}

          {/* RTF Fallback extracted content paper */}
          {!loading && !error && isFallback && (
            <div
              style={{
                width: "fit-content",
                minWidth: "min(100%, 780px)",
                maxWidth: "100%",
                margin: "0 auto",
                background: "#ffffff",
                color: "#1f2937",
                padding: "36px 44px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
                borderRadius: 4,
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: "var(--font-mono), Consolas, monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                boxSizing: "border-box",
              }}
            >
              {extractedText || "(No readable text extracted)"}
            </div>
          )}

          {/* rtf.js rendered HTML document */}
          <div
            ref={containerRef}
            className="rtf-preview-document"
            style={{
              display: loading || error || isFallback ? "none" : "block",
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
