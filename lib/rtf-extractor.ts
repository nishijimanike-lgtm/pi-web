/**
 * Extracts plain text content and table structure from raw RTF strings.
 * Used as a zero-dependency, ultra-fast, and robust fallback for RTF files
 * with complex macros, nested tables, or control words that fail client-side DOM parsers.
 */
export function extractRtfText(rtf: string): string {
  if (!rtf || typeof rtf !== "string") return "";

  let output = "";
  let i = 0;
  const len = rtf.length;
  let groupDepth = 0;
  let skipGroupAtDepth = -1;

  while (i < len) {
    const ch = rtf[i];

    if (ch === "{") {
      groupDepth++;
      const nextSlice = rtf.slice(i + 1, i + 35);
      const match = nextSlice.match(/^\\(\*?[a-zA-Z]+)/);
      if (match) {
        const word = match[1].toLowerCase();
        // Skip metadata groups, style definitions, fonts, color tables, and binary picture streams
        if (
          ["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "generator"].includes(word) ||
          word.startsWith("*")
        ) {
          if (skipGroupAtDepth === -1) skipGroupAtDepth = groupDepth;
        }
      }
      i++;
      continue;
    }

    if (ch === "}") {
      if (skipGroupAtDepth === groupDepth) {
        skipGroupAtDepth = -1;
      }
      groupDepth--;
      i++;
      continue;
    }

    if (skipGroupAtDepth !== -1) {
      i++;
      continue;
    }

    if (ch === "\\") {
      i++;
      if (i >= len) break;
      const next = rtf[i];

      // Escaped special characters
      if (next === "\\" || next === "{" || next === "}") {
        output += next;
        i++;
        continue;
      }

      // Hex character: \'hh
      if (next === "'") {
        const hex = rtf.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          output += String.fromCharCode(parseInt(hex, 16));
          i += 3;
          continue;
        }
      }

      // Non-breaking space
      if (next === "~") {
        output += " ";
        i++;
        continue;
      }

      // Non-breaking hyphen or optional hyphen
      if (next === "_" || next === "-") {
        output += "-";
        i++;
        continue;
      }

      // Control word
      const wordMatch = rtf.slice(i).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (wordMatch) {
        const word = wordMatch[1].toLowerCase();
        const param = wordMatch[2];

        if (word === "par" || word === "line" || word === "row") {
          output += "\n";
        } else if (word === "tab") {
          output += "\t";
        } else if (word === "cell") {
          output += "  \t  ";
        } else if (word === "u" && param) {
          let code = parseInt(param, 10);
          if (code < 0) code += 65536;
          output += String.fromCharCode(code);
          // RTF specifies that \uN is followed by replacement characters (usually '?')
          if (rtf[i + wordMatch[0].length] === "?") {
            i += 1;
          }
        }

        i += wordMatch[0].length;
        continue;
      }

      i++;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      // Raw newlines in RTF code are whitespace formatting, not document line breaks
      i++;
      continue;
    }

    output += ch;
    i++;
  }

  // Clean up excessive blank lines and leading/trailing whitespace
  return output.replace(/\n{3,}/g, "\n\n").trim();
}
