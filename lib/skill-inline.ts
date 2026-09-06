export interface LoadedSkillItem {
  name: string;
  filePath?: string;
  content?: string;
}

export interface SlashQueryMatch {
  /** Index of the "/" or "\" character in the text */
  start: number;
  /** Text typed after "/" or "\" (lowercase) */
  query: string;
  /** Prefix character used: "/" or "\" */
  prefixChar: "/" | "\\";
}

/**
 * Detect a "/" or "\" command/skill token immediately before the cursor.
 * The slash or backslash must be at the start of text or preceded by whitespace,
 * preventing Windows paths like C:\foo\bar from triggering.
 */
export function extractSlashQuery(
  textBeforeCursor: string,
): SlashQueryMatch | null {
  const match = /(?:^|\s)([\\/])([^\s\\/]*)$/.exec(textBeforeCursor);
  if (!match) return null;

  const prefixChar = match[1] as "/" | "\\";
  const query = match[2] ?? "";
  const start = textBeforeCursor.length - (query.length + 1);

  return {
    start,
    query: query.toLowerCase(),
    prefixChar,
  };
}

const INLINE_SKILL_RE =
  /(?:^|\s|[，。！？,\.!?([<{'\"])[\/\\](?:skill:)?([a-zA-Z0-9_-]+)(?=\s|$|[，。！？,\.!?\])}>'\"])/g;

function dirnameEnvPath(path?: string): string {
  if (!path) return "/";
  const normalized = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (separatorIndex === 2 && normalized[1] === ":")
    return normalized.slice(0, 3);
  return separatorIndex <= 0 ? "/" : normalized.slice(0, separatorIndex);
}

/**
 * Parses all skill references in a user prompt message (\skillName, \skill:name, /skill:name, /skillName)
 * and expands them into `<skill name="..." location="...">...</skill>` blocks prepended to the message.
 * Supports multiple skills invoked simultaneously anywhere in the text.
 */
export function expandInlineSkills(
  message: string,
  availableSkills: readonly LoadedSkillItem[],
): string {
  if (!message || availableSkills.length === 0) return message;
  // If message already starts with a skill block envelope, do not re-expand
  if (message.startsWith('<skill name="')) return message;

  const map = new Map<string, LoadedSkillItem>();
  for (const s of availableSkills) {
    map.set(s.name.toLowerCase(), s);
  }

  const matchedSkills: LoadedSkillItem[] = [];
  const seen = new Set<string>();

  INLINE_SKILL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_SKILL_RE.exec(message)) !== null) {
    const name = match[1].toLowerCase();
    const skill = map.get(name);
    if (skill && !seen.has(skill.name)) {
      seen.add(skill.name);
      matchedSkills.push(skill);
    }
  }

  if (matchedSkills.length === 0) return message;

  const skillBlocks = matchedSkills
    .map((skill) => {
      const loc = skill.filePath ? ` location="${skill.filePath}"` : "";
      const dir = dirnameEnvPath(skill.filePath);
      const body = skill.content
        ? `\nReferences are relative to ${dir}.\n\n${skill.content}`
        : "";
      return `<skill name="${skill.name}"${loc}>${body}\n</skill>`;
    })
    .join("\n\n");

  return `${skillBlocks}\n\n${message}`;
}
