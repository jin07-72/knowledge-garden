import assert from "node:assert/strict"
import { test } from "node:test"
import { countDomains } from "./GardenOverview"

test("counts published notes by domain and excludes domain indexes", () => {
  const files = [
    { slug: "index" },
    { slug: "reading/index" },
    { slug: "reading/active-recall" },
    { slug: "technology/css-grid" },
    { slug: "technology/devtools" },
  ]

  assert.deepEqual(countDomains(files), {
    reading: 1,
    technology: 2,
    language: 0,
    life: 0,
    total: 3,
  })
})
