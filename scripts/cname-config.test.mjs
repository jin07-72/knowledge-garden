import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { parse } from "yaml"

const configPath = fileURLToPath(new URL("../quartz.config.yaml", import.meta.url))

test("does not emit CNAME without a real custom domain", async () => {
  const config = parse(await readFile(configPath, "utf8"))
  const baseUrl = config.configuration?.baseUrl ?? ""
  const hostname = baseUrl.split("/")[0].split(":")[0]
  const usesDefaultHost = hostname === "localhost" || hostname.endsWith(".github.io")
  const cname = config.plugins.find((entry) => entry.source === "@quartz-community/cname")

  if (usesDefaultHost) {
    assert.notEqual(cname?.enabled, true, `CNAME must stay disabled for ${baseUrl}`)
  }
})
