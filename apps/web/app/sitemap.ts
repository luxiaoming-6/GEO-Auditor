import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/siteUrl";

// Static entry pages only — /report/{domain} links are per-domain and
// generated on demand, so they do not belong in the sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
