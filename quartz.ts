import { ConditionalRender } from "./quartz/components"
import GardenOverview from "./quartz/components/GardenOverview"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { PageTypes } from "./quartz/plugins"

const config = await loadQuartzConfig()
export default config

const loadedLayout = await loadQuartzLayout()
const homeOverview = ConditionalRender({
  component: GardenOverview(),
  condition: ({ fileData }) => fileData.slug === "index",
})

for (const pageLayout of [
  loadedLayout.defaults,
  loadedLayout.byPageType.content,
  loadedLayout.byPageType.folder,
]) {
  if (!pageLayout) continue
  pageLayout.afterBody = [homeOverview, ...(pageLayout.afterBody ?? [])]
}

const dispatcher = PageTypes.PageTypeDispatcher({
  defaults: loadedLayout.defaults,
  byPageType: loadedLayout.byPageType,
})
config.plugins.emitters = config.plugins.emitters.map((emitter) =>
  emitter.name === "PageTypeDispatcher" ? dispatcher : emitter,
)

export const layout = loadedLayout
