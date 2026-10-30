import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/siteUrl";
import { listStoredReports } from "../lib/reportsContent";

// Static entries + archived report articles. The fs reads happen at build
// time only (this file is prerendered — it never runs on the edge).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const reports = await listStoredReports();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/reports`,
      lastModified: reports[0] ? new Date(reports[0].report.auditedAt) : new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...reports.map(({ domain, report }) => ({
      url: `${SITE_URL}/reports/${domain}`,
      lastModified: new Date(report.auditedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
