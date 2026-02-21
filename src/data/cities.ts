export interface CityProfile {
  slug: string;
  name: string;
  shortDescription: string;
  keySectors: string[];
  signalsWeTrack: string[];
}

export const CITIES: CityProfile[] = [
  {
    slug: "palm-springs",
    name: "Palm Springs",
    shortDescription:
      "Palm Springs is a hospitality and culture anchor where visitor-facing AI adoption is accelerating. City operations also create visible test cases for service delivery and resident communication.",
    keySectors: ["Hospitality", "Public Services", "Creative Economy"],
    signalsWeTrack: [
      "Guest support automation pilots in hotels and venues",
      "Resident service chat and call-center modernization",
      "Downtown business adoption of practical AI tools",
    ],
  },
  {
    slug: "desert-hot-springs",
    name: "Desert Hot Springs",
    shortDescription:
      "Desert Hot Springs combines tourism, wellness, and local services with growing pressure to modernize operations. The city is a practical environment for low-cost AI adoption patterns.",
    keySectors: ["Wellness Tourism", "Small Business", "Public Services"],
    signalsWeTrack: [
      "Spa and hospitality workflow automation signals",
      "Small business use of AI for customer communication",
      "City service process improvements using digital tools",
    ],
  },
  {
    slug: "cathedral-city",
    name: "Cathedral City",
    shortDescription:
      "Cathedral City sits at a key regional crossroads with a mix of retail, logistics, and city services. Its implementation choices can spread quickly across neighboring communities.",
    keySectors: ["Retail", "Logistics", "Public Services"],
    signalsWeTrack: [
      "Retail AI rollout for demand and inventory decisions",
      "Permit and records workflow modernization",
      "Local workforce exposure to AI-enabled tools",
    ],
  },
  {
    slug: "rancho-mirage",
    name: "Rancho Mirage",
    shortDescription:
      "Rancho Mirage has concentrated healthcare and professional services with high expectations for quality and trust. AI adoption here is often risk-aware and governance-led.",
    keySectors: ["Healthcare", "Professional Services", "Hospitality"],
    signalsWeTrack: [
      "Clinical documentation and administrative AI pilots",
      "Professional service automation with oversight controls",
      "High-trust hospitality personalization use cases",
    ],
  },
  {
    slug: "palm-desert",
    name: "Palm Desert",
    shortDescription:
      "Palm Desert is a regional commerce and education hub where AI adoption can bridge enterprise and small-business needs. The city offers a broad view of operational maturity trends.",
    keySectors: ["Retail", "Education", "Professional Services"],
    signalsWeTrack: [
      "Retail operations intelligence and staffing tools",
      "Education and workforce AI readiness efforts",
      "SMB adoption of marketing and productivity automation",
    ],
  },
  {
    slug: "indian-wells",
    name: "Indian Wells",
    shortDescription:
      "Indian Wells has global event visibility and premium visitor experiences that reward operational precision. AI signals here often emerge from event logistics and guest journey optimization.",
    keySectors: ["Events", "Hospitality", "Tourism Operations"],
    signalsWeTrack: [
      "Event operations and scheduling optimization workflows",
      "Guest experience personalization across venues",
      "Data practices supporting seasonal demand planning",
    ],
  },
  {
    slug: "indio",
    name: "Indio",
    shortDescription:
      "Indio is a major event, logistics, and community services center with diverse operating environments. AI adoption patterns here highlight scale, seasonality, and workforce realities.",
    keySectors: ["Events", "Logistics", "Public Services"],
    signalsWeTrack: [
      "Festival and event infrastructure intelligence pilots",
      "Transportation and logistics coordination improvements",
      "Public service capacity planning and resident communication",
    ],
  },
  {
    slug: "la-quinta",
    name: "La Quinta",
    shortDescription:
      "La Quinta blends tourism, sports, and neighborhood-focused city services with strong quality expectations. AI adoption here is often tied to experience management and operational consistency.",
    keySectors: ["Hospitality", "Sports & Recreation", "Public Services"],
    signalsWeTrack: [
      "Resort and recreation operations automation",
      "Resident communication and city service responsiveness",
      "Local business AI usage for bookings and outreach",
    ],
  },
  {
    slug: "coachella",
    name: "Coachella",
    shortDescription:
      "Coachella is a fast-growing city where agriculture, logistics, and community services intersect. Tracking AI here captures both established industry modernization and new local capacity building.",
    keySectors: ["Agriculture", "Logistics", "Community Services"],
    signalsWeTrack: [
      "Agricultural planning and monitoring intelligence pilots",
      "Warehouse and logistics automation signals",
      "Community access to AI skills and support pathways",
    ],
  },
];

export const CITY_SLUGS = new Set(CITIES.map((city) => city.slug));

export const getCityBySlug = (slug: string) => CITIES.find((city) => city.slug === slug);
