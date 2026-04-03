import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories, selections } from "@genus/db";
import { getDashscope, MODEL } from "./dashscope.js";

async function callLLM(system: string, user: string, temp = 0.7): Promise<string> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: temp,
    max_tokens: 8192,
    // @ts-ignore
    enable_thinking: false,
  });
  return response.choices[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

// ── Dog Breeds Pool ──────────────────────────────────────

interface DogBreed {
  label: string;
  imagePrompt: string;
  tags: string[]; // e.g. ["large", "sporting", "american"]
}

async function buildDogPool() {
  console.log("\n=== Building Dog Breeds Pool ===\n");

  const prompt = {
    system: `You are a trivia game content designer. Generate a comprehensive list of visually distinctive dog breeds for a mobile game. Each breed will become an illustrated portrait.

RULES:
- Only include breeds that are VISUALLY DISTINCTIVE and globally recognizable
- Include a mix of popular and interesting breeds
- Each breed needs tags for categorization (size, origin region, type)
- The imagePrompt must include the breed's most distinctive visual features

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate 40 visually distinctive dog breeds.

Return JSON array:
[{"label": "Golden Retriever", "imagePrompt": "Golden Retriever dog, golden-blonde flowing fur, friendly face, floppy ears", "tags": ["large", "sporting", "american", "popular"]}]

Tags should include:
- Size: "small", "medium", "large"
- Type: "sporting", "working", "herding", "terrier", "toy", "hound"
- Origin: "american", "british", "german", "japanese", "french", "chinese", "russian", "african", "australian", "mexican"
- Other: "popular", "fluffy", "short-hair", "curly"`,
  };

  const raw = await callLLM(prompt.system, prompt.user);
  const breeds = parseJSON<DogBreed[]>(raw);

  console.log(`Generated ${breeds.length} dog breeds`);

  // Create category lenses
  const lenses = [
    { name: "Golden Retriever", slug: "golden-retriever", filter: (b: DogBreed) => b.label === "Golden Retriever" },
    { name: "Dalmatian", slug: "dalmatian", filter: (b: DogBreed) => b.label === "Dalmatian" },
    { name: "Shiba Inu", slug: "shiba-inu", filter: (b: DogBreed) => b.label === "Shiba Inu" },
    { name: "Poodle", slug: "poodle", filter: (b: DogBreed) => b.label === "Poodle" || b.label === "Toy Poodle" || b.label === "Miniature Poodle" },
    { name: "German Shepherd", slug: "german-shepherd", filter: (b: DogBreed) => b.label === "German Shepherd" },
    { name: "Bulldog", slug: "bulldog", filter: (b: DogBreed) => b.label.toLowerCase().includes("bulldog") },
    { name: "Husky", slug: "husky", filter: (b: DogBreed) => b.label.toLowerCase().includes("husky") },
    { name: "Small Dogs", slug: "small-dogs", filter: (b: DogBreed) => b.tags.includes("small") || b.tags.includes("toy") },
    { name: "Big Dogs", slug: "big-dogs", filter: (b: DogBreed) => b.tags.includes("large") },
    { name: "Japanese Dogs", slug: "japanese-dogs", filter: (b: DogBreed) => b.tags.includes("japanese") },
  ];

  for (const lens of lenses) {
    const correct = breeds.filter(lens.filter);
    const distractors = breeds.filter((b) => !lens.filter(b));

    if (correct.length === 0) {
      console.log(`  Skipping "${lens.name}" — no matches in pool`);
      continue;
    }

    // Insert category
    const [cat] = await db
      .insert(categories)
      .values({
        name: lens.name,
        slug: lens.slug,
        difficulty: correct.length <= 2 ? 1 : 2,
        isCurrentEvents: false,
        verified: true, // Pre-verified since we control the data
      })
      .returning();

    // Insert all breeds as selections for this category
    const selValues = [
      ...correct.map((b) => ({
        categoryId: cat.id,
        label: b.label,
        isCorrect: true,
        verified: true,
      })),
      ...distractors.map((b) => ({
        categoryId: cat.id,
        label: b.label,
        isCorrect: false,
        verified: true,
      })),
    ];

    await db.insert(selections).values(selValues);
    console.log(`  Created "${lens.name}" — ${correct.length} correct, ${distractors.length} distractors`);
  }
}

// ── Landmarks Pool ───────────────────────────────────────

interface Landmark {
  label: string;
  imagePrompt: string;
  country: string;
  region: string; // "north-america", "europe", "asia", "south-america", "africa", "oceania"
}

async function buildLandmarkPool() {
  console.log("\n=== Building Landmarks Pool ===\n");

  const prompt = {
    system: `You are a trivia game content designer. Generate a list of globally famous landmarks for a mobile game. Each will become an illustrated portrait.

RULES:
- Only include landmarks that are GLOBALLY RECOGNIZABLE — if you showed a photo to someone from any country, they'd know it
- Include the country and region for each
- The imagePrompt must capture the landmark's most distinctive visual features

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate 40 of the world's most visually recognizable landmarks.

Return JSON array:
[{"label": "Statue of Liberty", "imagePrompt": "Statue of Liberty, green copper statue holding torch, New York harbor", "country": "USA", "region": "north-america"}]

Regions: "north-america", "europe", "asia", "south-america", "africa", "oceania", "middle-east"`,
  };

  const raw = await callLLM(prompt.system, prompt.user);
  const landmarks = parseJSON<Landmark[]>(raw);

  console.log(`Generated ${landmarks.length} landmarks`);

  const lenses = [
    { name: "US Landmarks", slug: "us-landmarks", filter: (l: Landmark) => l.country === "USA" },
    { name: "French Landmarks", slug: "french-landmarks", filter: (l: Landmark) => l.country === "France" },
    { name: "Indian Landmarks", slug: "indian-landmarks", filter: (l: Landmark) => l.country === "India" },
    { name: "Italian Landmarks", slug: "italian-landmarks", filter: (l: Landmark) => l.country === "Italy" },
    { name: "Asian Landmarks", slug: "asian-landmarks", filter: (l: Landmark) => ["asia", "middle-east"].includes(l.region) },
    { name: "European Landmarks", slug: "european-landmarks", filter: (l: Landmark) => l.region === "europe" },
    { name: "Ancient Wonders", slug: "ancient-wonders", filter: (l: Landmark) => ["Great Pyramid", "Colosseum", "Parthenon", "Acropolis", "Stonehenge", "Angkor Wat", "Machu Picchu", "Chichen Itza", "Petra", "Great Wall"].some((w) => l.label.includes(w)) },
  ];

  for (const lens of lenses) {
    const correct = landmarks.filter(lens.filter);
    const distractors = landmarks.filter((l) => !lens.filter(l));

    if (correct.length === 0) {
      console.log(`  Skipping "${lens.name}" — no matches in pool`);
      continue;
    }

    const [cat] = await db
      .insert(categories)
      .values({
        name: lens.name,
        slug: lens.slug,
        difficulty: correct.length <= 3 ? 1 : 2,
        isCurrentEvents: false,
        verified: true,
      })
      .returning();

    const selValues = [
      ...correct.map((l) => ({
        categoryId: cat.id,
        label: l.label,
        isCorrect: true,
        verified: true,
      })),
      ...distractors.map((l) => ({
        categoryId: cat.id,
        label: l.label,
        isCorrect: false,
        verified: true,
      })),
    ];

    await db.insert(selections).values(selValues);
    console.log(`  Created "${lens.name}" — ${correct.length} correct, ${distractors.length} distractors`);
  }
}

// ── Company Logos Pool ───────────────────────────────────

interface CompanyLogo {
  label: string;
  industry: string; // "tech", "food", "automotive", "fashion", "finance", "entertainment", "retail"
  country: string;
  region: string;
}

async function buildLogoPool() {
  console.log("\n=== Building Company Logos Pool ===\n");

  const prompt = {
    system: `You are a trivia game content designer. Generate a list of globally famous companies whose LOGOS are instantly recognizable. These logos will be shown at small size on a mobile screen.

RULES:
- Only include companies with ICONIC, VISUALLY DISTINCTIVE logos that anyone worldwide would recognize
- Include the industry and country of origin
- Focus on consumer-facing brands (not B2B companies)

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate 50 companies with the most recognizable logos in the world.

Return JSON array:
[{"label": "Apple", "industry": "tech", "country": "USA", "region": "north-america"}]

Industries: "tech", "food", "automotive", "fashion", "finance", "entertainment", "retail", "sports", "beverage", "telecom"
Regions: "north-america", "europe", "asia", "south-america"`,
  };

  const raw = await callLLM(prompt.system, prompt.user);
  const companies = parseJSON<CompanyLogo[]>(raw);

  console.log(`Generated ${companies.length} company logos`);

  const lenses = [
    { name: "Tech Companies", slug: "tech-companies", filter: (c: CompanyLogo) => c.industry === "tech" },
    { name: "Food & Beverage", slug: "food-beverage", filter: (c: CompanyLogo) => ["food", "beverage"].includes(c.industry) },
    { name: "Car Brands", slug: "car-brands", filter: (c: CompanyLogo) => c.industry === "automotive" },
    { name: "Fashion Brands", slug: "fashion-brands", filter: (c: CompanyLogo) => c.industry === "fashion" },
    { name: "Japanese Companies", slug: "japanese-companies", filter: (c: CompanyLogo) => c.country === "Japan" },
    { name: "American Companies", slug: "american-companies", filter: (c: CompanyLogo) => c.country === "USA" },
    { name: "European Companies", slug: "european-companies", filter: (c: CompanyLogo) => c.region === "europe" },
    { name: "Entertainment", slug: "entertainment-companies", filter: (c: CompanyLogo) => c.industry === "entertainment" },
  ];

  for (const lens of lenses) {
    const correct = companies.filter(lens.filter);
    const distractors = companies.filter((c) => !lens.filter(c));

    if (correct.length === 0) {
      console.log(`  Skipping "${lens.name}" — no matches in pool`);
      continue;
    }

    const [cat] = await db
      .insert(categories)
      .values({
        name: lens.name,
        slug: lens.slug,
        difficulty: correct.length <= 5 ? 1 : 2,
        isCurrentEvents: false,
        verified: true,
      })
      .returning();

    const selValues = [
      ...correct.map((c) => ({
        categoryId: cat.id,
        label: c.label,
        isCorrect: true,
        verified: true,
      })),
      ...distractors.map((c) => ({
        categoryId: cat.id,
        label: c.label,
        isCorrect: false,
        verified: true,
      })),
    ];

    await db.insert(selections).values(selValues);
    console.log(`  Created "${lens.name}" — ${correct.length} correct, ${distractors.length} distractors`);
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  await buildDogPool();
  await buildLandmarkPool();
  await buildLogoPool();

  console.log("\n=== All pools built! ===\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
