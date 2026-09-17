import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { parse } from "yaml"

const configPath = fileURLToPath(new URL("../quartz.config.yaml", import.meta.url))

async function readConfig() {
  return parse(await readFile(configPath, "utf8"))
}

function plugin(config, source) {
  return config.plugins.find((entry) => entry.source === source)
}

test("keeps the configured always-dark palette and syntax theme authoritative", async () => {
  const config = await readConfig()
  const expectedPalette = {
    light: "#101318",
    lightgray: "#252b34",
    gray: "#566170",
    darkgray: "#c2ccd6",
    dark: "#f0f4f8",
    secondary: "#8bd5ca",
    tertiary: "#f5a97f",
    highlight: "rgba(139, 213, 202, 0.12)",
    textHighlight: "rgba(245, 169, 127, 0.26)",
  }

  assert.equal(plugin(config, "@quartz-themes/core").enabled, false)
  assert.equal(plugin(config, "@quartz-community/darkmode").enabled, false)
  assert.deepEqual(config.configuration.theme.colors.lightMode, expectedPalette)
  assert.deepEqual(config.configuration.theme.colors.darkMode, expectedPalette)

  const syntaxTheme = plugin(config, "@quartz-community/syntax-highlighting").options.theme
  assert.equal(syntaxTheme.light, "github-dark")
  assert.equal(syntaxTheme.dark, "github-dark")
})
