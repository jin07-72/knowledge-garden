import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"

const domains = [
  { slug: "reading", number: "01", title: "读书与思考", detail: "书籍、课程、学习方法与观点" },
  { slug: "technology", number: "02", title: "技术与工具", detail: "编程、软件与效率工作流" },
  { slug: "language", number: "03", title: "语言学习", detail: "词汇、语法、输入与输出练习" },
  { slug: "life", number: "04", title: "生活实验", detail: "观察、复盘与实践记录" },
] as const

type SlugData = { slug?: string }

export function countDomains(files: SlugData[]) {
  const result = { reading: 0, technology: 0, language: 0, life: 0, total: 0 }
  for (const file of files) {
    const slug = file.slug ?? ""
    for (const domain of domains) {
      if (slug.startsWith(`${domain.slug}/`) && slug !== `${domain.slug}/index`) {
        result[domain.slug] += 1
        result.total += 1
      }
    }
  }
  return result
}

const GardenOverview: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
  const counts = countDomains(allFiles)
  return (
    <section class="garden-overview" aria-label="知识领域">
      <p class="garden-stats">{counts.total} notes · 4 domains</p>
      <div class="domain-grid">
        {domains.map((domain) => (
          <a
            class="domain-card"
            href={resolveRelative(fileData.slug!, `${domain.slug}/index` as FullSlug)}
          >
            <span>{domain.number}</span>
            <strong>{domain.title}</strong>
            <small>
              {domain.detail} · {counts[domain.slug]} notes
            </small>
          </a>
        ))}
      </div>
    </section>
  )
}

export default (() => GardenOverview) satisfies QuartzComponentConstructor
