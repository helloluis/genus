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

interface Monster {
  label: string;
  imagePrompt: string;
  tags: string[];
}

async function main() {
  console.log("\n=== Building Movie Monsters Pool ===\n");

  const prompt = {
    system: `You are a pop culture expert designing content for a trivia game. Generate a comprehensive list of iconic movie/TV/game monsters and horror villains. Each will become an illustrated close-up portrait.

RULES:
- Only include monsters/villains that are VISUALLY DISTINCTIVE and GLOBALLY RECOGNIZABLE
- They must have an ICONIC visual design that anyone would recognize from an illustration
- Include classic horror, modern horror, kaiju, sci-fi creatures, fantasy monsters, video game monsters
- Each needs ACCURATE tags for categorization
- The imagePrompt must capture their most distinctive visual features

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate 45 iconic movie monsters, horror villains, and famous creatures from film/TV/games.

Return JSON array:
[{"label": "Dracula", "imagePrompt": "Classic Count Dracula vampire, pale white face, slicked-back black hair, high collar black cape with red lining, fangs visible, piercing eyes", "tags": ["vampire", "undead", "classic-horror", "humanoid", "pre-1980", "supernatural"]}]

Tags MUST include ALL that apply:
- Era: "pre-1980", "1980s", "1990s", "2000s", "2010s"
- Type: "vampire", "werewolf", "zombie", "ghost", "demon", "alien", "kaiju", "slasher", "robot", "mutant", "undead", "witch", "monster"
- Origin: "classic-horror", "modern-horror", "sci-fi", "fantasy", "video-game", "anime", "mythology"
- Trait: "humanoid", "giant", "mask", "claws", "tentacles", "wings", "teeth", "weapon", "supernatural", "mechanical", "shapeshifter"
- Franchise: use the franchise name as a tag (e.g. "alien-franchise", "friday-13th", "halloween", "godzilla-franchise", "lord-of-rings", "resident-evil", "silent-hill")

Include a good variety:
- Classic monsters: Dracula, Frankenstein's Monster, The Mummy, Wolfman, etc.
- Slashers: Freddy, Jason, Michael Myers, Ghostface, Leatherface, etc.
- Sci-fi: Xenomorph, Predator, The Thing, Terminators, etc.
- Kaiju: Godzilla, King Kong, Mothra, etc.
- Fantasy/modern: Sauron, Balrog, Demogorgon, Pennywise, etc.
- Video game: Pyramid Head, Nemesis, Creepers, etc.
- Anime: Titans (AoT), Hollows (Bleach), etc.`
  };

  const raw = await callLLM(prompt.system, prompt.user, 0.5);
  const monsters = parseJSON<Monster[]>(raw);

  console.log(`Generated ${monsters.length} monsters\n`);

  // Print tag distribution
  const tagCounts: Record<string, number> = {};
  for (const m of monsters) {
    for (const t of m.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  const lenses: { name: string; slug: string; filter: (m: Monster) => boolean }[] = [
    // Era
    { name: "Classic Monsters", slug: "classic-monsters", filter: (m) => m.tags.includes("classic-horror") || m.tags.includes("pre-1980") },
    { name: "80s Horror Icons", slug: "80s-horror", filter: (m) => m.tags.includes("1980s") },

    // Type
    { name: "The Undead!", slug: "the-undead", filter: (m) => m.tags.includes("undead") || m.tags.includes("vampire") || m.tags.includes("zombie") || m.tags.includes("ghost") },
    { name: "Wears a Mask", slug: "wears-a-mask", filter: (m) => m.tags.includes("mask") },
    { name: "Not From This Planet", slug: "not-from-earth", filter: (m) => m.tags.includes("alien") || m.tags.includes("sci-fi") },
    { name: "Bigger Than a Building", slug: "bigger-than-building", filter: (m) => m.tags.includes("giant") || m.tags.includes("kaiju") },
    { name: "Looks Human... Almost", slug: "looks-human", filter: (m) => m.tags.includes("humanoid") && !m.tags.includes("giant") },
    { name: "Has Claws or Teeth", slug: "claws-or-teeth", filter: (m) => m.tags.includes("claws") || m.tags.includes("teeth") },
    { name: "Carries a Weapon", slug: "carries-weapon", filter: (m) => m.tags.includes("weapon") },
    { name: "Supernatural Powers", slug: "supernatural-powers", filter: (m) => m.tags.includes("supernatural") || m.tags.includes("demon") },

    // Origin
    { name: "From a Video Game", slug: "videogame-monsters", filter: (m) => m.tags.includes("video-game") },
    { name: "Slasher Villains", slug: "slasher-villains", filter: (m) => m.tags.includes("slasher") },
  ];

  let created = 0;
  for (const lens of lenses) {
    const correct = monsters.filter(lens.filter);
    const distractors = monsters.filter((m) => !lens.filter(m));

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
      ...correct.map((m) => ({
        categoryId: cat.id,
        label: m.label,
        isCorrect: true,
        verified: true,
      })),
      ...distractors.map((m) => ({
        categoryId: cat.id,
        label: m.label,
        isCorrect: false,
        verified: true,
      })),
    ];

    await db.insert(selections).values(selValues);
    console.log(`  Created "${lens.name}" — ${correct.length} correct, ${distractors.length} distractors`);
    created++;
  }

  console.log(`\n=== Monster pool done! ${created} categories created from ${monsters.length} monsters ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
