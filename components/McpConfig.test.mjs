import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");

test("McpConfig uses standard config components and layouts", () => {
  assert.match(source, /<ConfigPanelShell/);
  assert.match(source, /<ConfigSplitView/);
  assert.match(source, /<ConfigSidebar/);
  assert.match(source, /<ConfigDetail/);
  assert.match(source, /<ConfigFooter/);
  assert.match(source, /<ConfigListAction/);
  assert.match(source, /<ConfigSidebarItem/);
  assert.match(source, /<ConfigStatusDot/);
  assert.match(source, /<ConfigSidebarText/);
  assert.match(source, /<ConfigDetailStack/);
  assert.match(source, /<ConfigDetailHeader/);
  assert.match(source, /<ConfigDetailActions/);
  assert.match(source, /<ConfigSwitch/);
});

test("McpConfig restores last selection and supports preset templates", () => {
  assert.match(source, /getLastSettingsSelection\("mcp",\s*cwd\)/);
  assert.match(source, /setLastSettingsSelection\("mcp",/);
  assert.match(source, /MCP_PRESETS/);
  assert.match(source, /filesystem/);
  assert.match(source, /memory/);
  assert.match(source, /fetch/);
});

test("McpConfig supports connection testing and reload notifications", () => {
  assert.match(source, /handleTestConnection/);
  assert.match(source, /\/api\/mcp\/test/);
  assert.match(source, /sendAgentCommand\(sessionId,\s*\{\s*type:\s*"reload"\s*\}\)/);
});
