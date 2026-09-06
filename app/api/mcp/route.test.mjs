import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-mcp-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, PUT, PATCH, DELETE } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

test("MCP API route supports listing, creating, updating, toggling, and deleting", async () => {
  // 1. Initial GET
  let res = await GET(new Request("http://localhost/api/mcp"));
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.ok(Array.isArray(data.servers));
  assert.equal(data.servers.length, 0);

  // 2. Create server via POST
  res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        name: "test-mcp",
        server: {
          command: "npx",
          args: ["-y", "dummy-mcp"],
          type: "stdio",
        },
      }),
    }),
  );
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.server.name, "test-mcp");

  // 3. Update server via PUT
  res = await PUT(
    new Request("http://localhost/api/mcp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        oldName: "test-mcp",
        name: "test-mcp-renamed",
        server: {
          command: "uvx",
          args: ["dummy-mcp-v2"],
        },
      }),
    }),
  );
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.server.name, "test-mcp-renamed");
  assert.equal(data.server.command, "uvx");

  // 4. Toggle disabled via PATCH
  res = await PATCH(
    new Request("http://localhost/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        name: "test-mcp-renamed",
        disabled: true,
      }),
    }),
  );
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.server.disabled, true);

  // 5. Delete server via DELETE
  res = await DELETE(
    new Request("http://localhost/api/mcp?name=test-mcp-renamed&scope=global", {
      method: "DELETE",
    }),
  );
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.success, true);

  // 6. Verify empty again
  res = await GET(new Request("http://localhost/api/mcp"));
  data = await res.json();
  assert.equal(data.servers.length, 0);
});
