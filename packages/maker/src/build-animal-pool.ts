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
    max_tokens: 16384,
    // @ts-ignore
    enable_thinking: false,
  });
  return response.choices[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

interface Animal {
  label: string;
  imagePrompt: string;
  tags: string[];
}

async function main() {
  console.log("\n=== Building Animal Pool ===\n");

  // Generate a huge list of animals with rich tags
  const prompt = {
    system: `You are a zoology expert designing content for a trivia game. Generate a comprehensive list of visually distinctive animals. Each animal will become an illustrated close-up portrait on a mobile screen.

RULES:
- Only include animals that are VISUALLY DISTINCTIVE and globally recognizable
- Cover a wide range: mammals, birds, reptiles, amphibians, fish, insects, arachnids, crustaceans, mollusks
- Each animal needs ACCURATE biological tags — these will be used to generate trivia categories, so correctness is critical
- The imagePrompt must capture the animal's most distinctive visual features

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate 80 visually distinctive animals from across the animal kingdom.

Return JSON array:
[{"label": "Penguin", "imagePrompt": "Emperor Penguin, black and white tuxedo body, orange cheek patches, standing upright on ice", "tags": ["bird", "flightless", "2-legs", "lays-eggs", "cold-climate", "aquatic", "carnivore", "antarctic"]}]

Tags MUST include ALL that apply from these categories:
- Class: "mammal", "bird", "reptile", "amphibian", "fish", "insect", "arachnid", "crustacean", "mollusk"
- Legs: "no-legs", "2-legs", "4-legs", "6-legs", "8-legs", "many-legs"
- Reproduction: "lays-eggs", "live-birth", "marsupial"
- Diet: "carnivore", "herbivore", "omnivore"
- Habitat: "aquatic", "flying", "underground", "arboreal", "desert", "cold-climate", "tropical"
- Special: "venomous", "nocturnal", "endangered", "domesticated", "flightless", "shell", "stripes", "spots", "horns", "tusks", "pouch"
- Size: "tiny", "small", "medium", "large", "massive"
- Region: "african", "asian", "australian", "north-american", "south-american", "european", "arctic", "antarctic"

Be thorough with tags — the more accurate tags, the better categories we can create.
Include a good variety: at least 15 mammals, 10 birds, 8 reptiles, 5 amphibians, 5 fish, 8 insects/arachnids, 5 sea creatures.`,
  };

  const raw = await callLLM(prompt.system, prompt.user, 0.5);
  const animals = parseJSON<Animal[]>(raw);

  console.log(`Generated ${animals.length} animals\n`);

  // Print tag distribution
  const tagCounts: Record<string, number> = {};
  for (const a of animals) {
    for (const t of a.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  // Define interesting category lenses
  const lenses: { name: string; slug: string; filter: (a: Animal) => boolean }[] = [
    // Reproduction
    { name: "They Lay Eggs", slug: "lay-eggs", filter: (a) => a.tags.includes("lays-eggs") },
    { name: "Marsupials", slug: "marsupials", filter: (a) => a.tags.includes("marsupial") },

    // Leg count
    { name: "2 Legs or Less", slug: "2-legs-or-less", filter: (a) => a.tags.includes("2-legs") || a.tags.includes("no-legs") },
    { name: "More Than 4 Legs", slug: "more-than-4-legs", filter: (a) => a.tags.includes("6-legs") || a.tags.includes("8-legs") || a.tags.includes("many-legs") },
    { name: "No Legs!", slug: "no-legs", filter: (a) => a.tags.includes("no-legs") },

    // Diet
    { name: "Herbivores", slug: "herbivores", filter: (a) => a.tags.includes("herbivore") },
    { name: "Carnivores", slug: "carnivores", filter: (a) => a.tags.includes("carnivore") },

    // Habitat
    { name: "Ocean Animals", slug: "ocean-animals", filter: (a) => a.tags.includes("aquatic") && !a.tags.includes("domesticated") },
    { name: "They Can Fly", slug: "can-fly", filter: (a) => a.tags.includes("flying") },
    { name: "Night Creatures", slug: "nocturnal", filter: (a) => a.tags.includes("nocturnal") },
    { name: "Desert Animals", slug: "desert-animals", filter: (a) => a.tags.includes("desert") },

    // Visual features
    { name: "Striped Animals", slug: "striped-animals", filter: (a) => a.tags.includes("stripes") },
    { name: "Spotted Animals", slug: "spotted-animals", filter: (a) => a.tags.includes("spots") },
    { name: "Has a Shell", slug: "has-shell", filter: (a) => a.tags.includes("shell") },
    { name: "Horns or Tusks", slug: "horns-tusks", filter: (a) => a.tags.includes("horns") || a.tags.includes("tusks") },

    // Danger
    { name: "Venomous!", slug: "venomous-animals", filter: (a) => a.tags.includes("venomous") },

    // Class
    { name: "Reptiles", slug: "reptiles", filter: (a) => a.tags.includes("reptile") },
    { name: "Insects", slug: "insects", filter: (a) => a.tags.includes("insect") },
    { name: "Birds", slug: "birds-pool", filter: (a) => a.tags.includes("bird") },
    { name: "Mammals", slug: "mammals-pool", filter: (a) => a.tags.includes("mammal") },
    { name: "Amphibians", slug: "amphibians", filter: (a) => a.tags.includes("amphibian") },

    // Region
    { name: "Australian Animals", slug: "australian-animals", filter: (a) => a.tags.includes("australian") },
    { name: "African Animals", slug: "african-animals", filter: (a) => a.tags.includes("african") },

    // Size extremes
    { name: "Tiny Creatures", slug: "tiny-creatures", filter: (a) => a.tags.includes("tiny") || a.tags.includes("small") },
    { name: "Massive Animals", slug: "massive-animals", filter: (a) => a.tags.includes("massive") || a.tags.includes("large") },

    // Fun combos
    { name: "Can't Fly (But Has Wings)", slug: "flightless", filter: (a) => a.tags.includes("flightless") },
    { name: "Endangered Species", slug: "endangered-pool", filter: (a) => a.tags.includes("endangered") },
  ];

  let created = 0;
  for (const lens of lenses) {
    const correct = animals.filter(lens.filter);
    const distractors = animals.filter((a) => !lens.filter(a));

    // Need at least 1 correct and 25 total
    if (correct.length === 0 || correct.length + distractors.length < 25) {
      console.log(`  Skipping "${lens.name}" — ${correct.length} correct, pool too small`);
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
      ...correct.map((a) => ({
        categoryId: cat.id,
        label: a.label,
        isCorrect: true,
        verified: true,
      })),
      ...distractors.map((a) => ({
        categoryId: cat.id,
        label: a.label,
        isCorrect: false,
        verified: true,
      })),
    ];

    await db.insert(selections).values(selValues);
    console.log(`  Created "${lens.name}" — ${correct.length} correct, ${distractors.length} distractors`);
    created++;
  }

  console.log(`\n=== Animal pool done! ${created} categories created from ${animals.length} animals ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
