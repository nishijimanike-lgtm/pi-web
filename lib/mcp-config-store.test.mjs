import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  deleteMcpServer,
  listMcpServers,
  readMcpFile,
  saveMcpServer,
  toggleMcpServer,
  writeMcpFile,
} = await jiti.import("./mcp-config-store.ts");

test("listMcpServers handles empty / non-existent config", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  try {
    const res = listMcpServers(tempDir);
    assert.ok(Array.isArray(res.servers));
    assert.equal(res.projectAvailable, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveMcpServer creates and updates an MCP server configuration", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  try {
    const configPath = join(tempDir, ".pi", "agent", "mcp.json");
    writeMcpFile(configPath, {
      mcpServers: {
        testServer: {
          command: "npx",
          args: ["-y", "mcp-test"],
          type: "stdio",
        },
      },
    });

    const file = readMcpFile(configPath);
    assert.equal(file.mcpServers.testServer.command, "npx");

    // Update server
    saveMcpServer(
      "project",
      "testServer",
      { command: "uvx", args: ["mcp-updated"] },
      tempDir,
    );

    const updated = readMcpFile(configPath);
    assert.equal(updated.mcpServers.testServer.command, "uvx");
    assert.deepEqual(updated.mcpServers.testServer.args, ["mcp-updated"]);

    // Toggle disabled
    toggleMcpServer("project", "testServer", true, tempDir);
    const toggled = readMcpFile(configPath);
    assert.equal(toggled.mcpServers.testServer.disabled, true);

    // Delete server
    deleteMcpServer("project", "testServer", tempDir);
    const deleted = readMcpFile(configPath);
    assert.equal(deleted.mcpServers.testServer, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
