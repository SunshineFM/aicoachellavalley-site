import fs from "node:fs/promises";
import path from "node:path";

export type ResearchHit = {
  sourceUrl: string;
  sourceType: "youtube" | "pdf" | "agenda" | "minutes" | "webpage";
  title: string;
  date: string | null;
  timestampOrPage: string | null;
  snippet: string;
  keywords: string[];
  confidence?: "low" | "med" | "high";
  notes?: string;
};

export type CityResearchFile = {
  citySlug: string;
  year: number;
  lastScanDate: string;
  coverage: {
    meetingsScanned: number | null;
    transcriptsAvailable: number | null;
    documentsScanned: number | null;
    aiMentionsFound: number | null;
    notes?: string;
  };
  sourcesScanned: Array<{
    url: string;
    type: string;
    label: string;
  }>;
  hits: ResearchHit[];
};

export const loadCityResearch = async ({
  citySlug,
  year,
}: {
  citySlug: string;
  year: number;
}): Promise<CityResearchFile | null> => {
  const filePath = path.join(process.cwd(), "docs", "research", String(year), `${citySlug}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as CityResearchFile;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};
