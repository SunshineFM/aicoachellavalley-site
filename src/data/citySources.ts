export type CitySource = {
  citySlug: string;
  sources: Array<{
    type: "youtube" | "video-archive" | "agendas-minutes" | "docs" | "city-site" | "econ-dev";
    label: string;
    url: string;
    notes?: string;
    verified?: boolean;
  }>;
};

export const citySourcesBySlug: Record<string, CitySource["sources"]> = {
  "palm-springs": [
    {
      type: "agendas-minutes",
      label: "City Council Meetings",
      url: "https://www.palmspringsca.gov/government/city-clerk/city-council-meetings/city-council-agenda-archive",
      notes: "Primary archive for council meetings and agenda packets.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Clerk",
      url: "https://www.palmspringsca.gov/government/city-clerk",
      notes: "Official records hub for notices, documents, and agendas.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Palm Springs YouTube",
      url: "https://www.youtube.com/@CityofPalmSprings",
      notes: "Official city channel for public meeting videos.",
      verified: false,
    },
  ],
  "desert-hot-springs": [
    {
      type: "agendas-minutes",
      label: "City Council Agendas",
      url: "https://www.cityofdhs.org/city-council-agendas/",
      notes: "Primary council agenda archive.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Clerk",
      url: "https://www.cityofdhs.org/departments/city-clerk/",
      notes: "Official records and filing reference page.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Desert Hot Springs YouTube",
      url: "https://www.youtube.com/channel/UC6I0eH2pIjdRtqc9696_e7g",
      notes: "City video channel for meetings and updates.",
      verified: false,
    },
  ],
  "cathedral-city": [
    {
      type: "agendas-minutes",
      label: "Agendas and Minutes",
      url: "https://www.cathedralcity.gov/departments/new-advanced-components/calendar-meeting-list",
      notes: "City council and commission documents archive.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Council Meetings",
      url: "https://www.cathedralcity.gov/government/city-clerk",
      notes: "Council meeting schedules and supporting links.",
      verified: false,
    },
    {
      type: "youtube",
      label: "Cathedral City Government YouTube",
      url: "https://www.youtube.com/c/Discovercathedralcity",
      notes: "Official city channel for recorded sessions.",
      verified: false,
    },
  ],
  "rancho-mirage": [
    {
      type: "agendas-minutes",
      label: "City Council",
      url: "https://ranchomirageca.gov/our_city/city_government/city_council_meeting_agendas.php",
      notes: "Council page with meeting materials and schedules.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Clerk Agendas and Minutes",
      url: "https://ranchomirageca.gov/our_city/city_departments/city_clerk.php",
      notes: "Primary records archive for agenda and minutes.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Rancho Mirage YouTube",
      url: "https://www.youtube.com/@cityofranchomirageca",
      notes: "City video channel for meeting recordings.",
      verified: false,
    },
  ],
  "palm-desert": [
    {
      type: "agendas-minutes",
      label: "City Council Meetings",
      url: "https://www.palmdesert.gov/connect/city-council",
      notes: "Council schedules and linked agenda materials.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Clerk Agendas and Minutes",
      url: "https://www.palmdesert.gov/departments/city-clerk",
      notes: "Official records archive for meeting docs.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Palm Desert YouTube",
      url: "https://www.youtube.com/@palmdesertmeetings",
      notes: "Official city meeting and update videos.",
      verified: false,
    },
  ],
  "indian-wells": [
    {
      type: "agendas-minutes",
      label: "City Council Meetings",
      url: "https://www.cityofindianwells.org/i-want-to/view/view-city-council-meetings/city-council-meetings",
      notes: "Primary meetings entrypoint with council records.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Clerk",
      url: "https://www.cityofindianwells.org/city-hall/departments/city-clerk",
      notes: "Official notices and records references.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Indian Wells YouTube",
      url: "https://www.youtube.com/@CityofIndianWells",
      notes: "City meeting recording channel.",
      verified: false,
    },
  ],
  indio: [
    {
      type: "agendas-minutes",
      label: "Agendas, Minutes, and Videos",
      url: "https://www.indio.org/departments/city-clerk/agendas-minutes-videos",
      notes: "Primary city archive for council docs and videos.",
      verified: false,
    },
    {
      type: "docs",
      label: "City Council",
      url: "https://www.indio.org/departments/city-clerk/agendas-minutes-videos",
      notes: "Council page with schedules and public materials.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Indio YouTube",
      url: "https://www.youtube.com/channel/UCnJCb93GZ3LsUSpDYss2oWA",
      notes: "Official city channel for public meeting videos.",
      verified: false,
    },
  ],
  "la-quinta": [
    {
      type: "agendas-minutes",
      label: "City Council Agendas",
      url: "https://www.laquintaca.gov/business/city-council/city-council-agendas",
      notes: "Primary agenda and packet archive.",
      verified: false,
    },
    {
      type: "video-archive",
      label: "City Council Videos",
      url: "https://www.laquintaca.gov/our-city/city-government/public-meetings",
      notes: "Official video archive for city council sessions.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of La Quinta YouTube",
      url: "https://www.youtube.com/c/Playinlaquinta",
      notes: "City video channel for public meetings and updates.",
      verified: false,
    },
  ],
  coachella: [
    {
      type: "agendas-minutes",
      label: "Agendas and Minutes",
      url: "https://www.coachella.org/city-government/city-council/agendas-and-minutes",
      notes: "Primary council docs archive.",
      verified: false,
    },
    {
      type: "video-archive",
      label: "City Council Videos",
      url: "https://www.coachella.org/city-government/city-council/meeting-video",
      notes: "Official city video archive.",
      verified: false,
    },
    {
      type: "youtube",
      label: "City of Coachella YouTube",
      url: "https://www.youtube.com/channel/UCNarFWjW6dMs57G2tDZ0PzA/videos",
      notes: "Official city channel for meeting recordings.",
      verified: false,
    },
  ],
};
