import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, selections, categories, poolItems } from "@genus/db";
import { eq, sql } from "drizzle-orm";
import { getDashscope, MODEL } from "./dashscope.js";

async function callLLM(system: string, user: string): Promise<string> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
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

/** Get unique labels + imageUrls from old selections for a set of category slugs */
async function getUniqueItems(slugPrefix: string): Promise<{ label: string; imageUrl: string | null }[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (s.label) s.label, s.image_url
    FROM selections s
    JOIN categories c ON s.category_id = c.id
    WHERE c.slug LIKE ${slugPrefix + '%'}
      AND s.image_status = 'success'
    ORDER BY s.label, s.id
  `);
  return (rows as any).map((r: any) => ({ label: r.label, imageUrl: r.image_url }));
}

/** Get unique items by exact category slugs */
async function getItemsBySlugs(slugs: string[]): Promise<{ label: string; imageUrl: string | null }[]> {
  const placeholders = slugs.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await db.execute(sql.raw(
    `SELECT DISTINCT ON (s.label) s.label, s.image_url
     FROM selections s
     JOIN categories c ON s.category_id = c.id
     WHERE c.slug IN (${slugs.map(s => `'${s}'`).join(', ')})
       AND s.image_status = 'success'
     ORDER BY s.label, s.id`
  ));
  return (rows as any).map((r: any) => ({ label: r.label, imageUrl: r.image_url }));
}

interface TaggedItem {
  label: string;
  tags: string[];
}

const TAG_SYSTEM = `You are a taxonomy expert. Given a list of items from a specific domain, assign accurate tags to each one. Tags must be lowercase, hyphenated strings. Be thorough — each item should have 5-15 tags covering all relevant dimensions. Respond ONLY with valid JSON, no markdown fences.`;

async function tagPool(
  poolName: string,
  items: { label: string; imageUrl: string | null }[],
  tagPrompt: string
): Promise<void> {
  console.log(`\n=== Tagging ${poolName} pool (${items.length} items) ===`);

  // Tag in batches of 40 to avoid token limits
  const BATCH = 40;
  const allTagged: TaggedItem[] = [];

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const labels = batch.map((item, idx) => `${idx + 1}. ${item.label}`).join("\n");

    console.log(`  Tagging batch ${Math.floor(i / BATCH) + 1} (${batch.length} items)...`);

    const raw = await callLLM(TAG_SYSTEM, `${tagPrompt}\n\nItems:\n${labels}\n\nReturn JSON array:\n[{"label": "Lion", "tags": ["mammal", "large", "carnivore", "african", "savanna", "cat", "big-cat", "mane", "apex-predator"]}]`);
    const tagged = parseJSON<TaggedItem[]>(raw);
    allTagged.push(...tagged);
  }

  // Insert into pool_items, matching image URLs from old data
  const imageMap = new Map(items.map((i) => [i.label, i.imageUrl]));
  let inserted = 0;

  for (const item of allTagged) {
    const imageUrl = imageMap.get(item.label);
    await db.insert(poolItems).values({
      pool: poolName,
      label: item.label,
      imageUrl: imageUrl ?? null,
      imageStatus: imageUrl ? "success" : "pending",
      tags: item.tags,
    });
    inserted++;
  }

  console.log(`  Inserted ${inserted} items into pool_items`);
}

async function main() {
  // Check if pool_items already has data
  const existing = await db.execute(sql`SELECT count(*) as cnt FROM pool_items`);
  const count = Number((existing as any)[0]?.cnt ?? 0);
  if (count > 0) {
    console.log(`pool_items already has ${count} rows. Skipping migration.`);
    console.log("To re-run, first: DELETE FROM pool_items;");
    process.exit(0);
  }

  // ── Animals ──
  const animalSlugs = [
    "lay-eggs", "marsupials", "2-legs-or-less", "more-than-4-legs", "no-legs",
    "herbivores", "carnivores", "ocean-animals", "can-fly", "nocturnal",
    "desert-animals", "spotted-animals", "has-shell", "horns-tusks",
    "venomous-animals", "reptiles", "insects", "birds-pool", "mammals-pool",
    "amphibians", "australian-animals", "african-animals", "tiny-creatures",
    "massive-animals", "flightless", "endangered-pool"
  ];
  const animals = await getItemsBySlugs(animalSlugs);
  await tagPool("animals", animals, `Tag each animal with ALL applicable tags from these dimensions:
- Class: mammal, bird, reptile, amphibian, insect, arachnid, crustacean, mollusk, fish
- Size: tiny (fits in palm), small (cat-sized), medium (dog-sized), large (cow-sized), massive (elephant+)
- Weight comparison: lighter-than-a-child, heavier-than-a-person, heavier-than-a-car
- Habitat: ocean, freshwater, desert, forest, jungle, arctic, savanna, mountain, cave, wetland
- Region: african, asian, australian, north-american, south-american, european, antarctic, worldwide
- Diet: carnivore, herbivore, omnivore
- Legs: no-legs, 2-legs, 4-legs, 6-legs, 8-legs, many-legs
- Traits: venomous, poisonous, endangered, nocturnal, can-fly, flightless, has-shell, has-horns, has-tusks, spotted, striped, bioluminescent, camouflage, armored
- Reproduction: lays-eggs, live-birth, marsupial
- Speed: slow, fast, very-fast
- Misc: domesticated, aquatic, amphibious, solitary, pack-animal, migratory, scavenger, apex-predator, pet`);

  // ── Dogs ──
  const dogSlugs = [
    "golden-retriever", "dalmatian", "shiba-inu", "poodle", "german-shepherd",
    "bulldog", "husky", "small-dogs", "big-dogs", "japanese-dogs"
  ];
  const dogs = await getItemsBySlugs(dogSlugs);
  await tagPool("dogs", dogs, `Tag each dog breed with ALL applicable tags:
- Size: tiny, small, medium, large, giant
- Group: sporting, working, herding, terrier, toy, hound, non-sporting, companion
- Origin country/region: american, british, german, french, japanese, chinese, russian, australian, mexican, african, swiss, belgian, italian, scandinavian
- Coat: fluffy, short-hair, long-hair, curly, wiry, double-coat, hairless
- Color patterns: spotted, solid, brindle, merle, black, white, brown, golden, multi-color
- Traits: family-friendly, guard-dog, hypoallergenic, athletic, gentle, stubborn, intelligent, independent, energetic, calm, lap-dog
- Purpose: hunting, herding, sledding, rescue, police, therapy, racing
- Distinctive features: wrinkled, flat-face, long-ears, pointy-ears, docked-tail, bushy-tail, muscular, slim`);

  // ── Landmarks ──
  const landmarkSlugs = [
    "us-landmarks", "french-landmarks", "indian-landmarks", "italian-landmarks",
    "asian-landmarks", "european-landmarks", "ancient-wonders"
  ];
  const landmarks = await getItemsBySlugs(landmarkSlugs);
  await tagPool("landmarks", landmarks, `Tag each landmark with ALL applicable tags:
- Region: north-america, south-america, europe, asia, africa, oceania, middle-east
- Country: use the actual country name as a tag (e.g. "usa", "france", "india", "japan", "egypt")
- Type: building, monument, statue, bridge, tower, castle, palace, temple, church, mosque, ruins, pyramid, wall, gate, falls, mountain, natural-wonder
- Era: ancient (pre-500AD), medieval (500-1500), colonial (1500-1800), modern (1800+), contemporary (1950+)
- Material: stone, marble, metal, glass, concrete, brick, wood
- Traits: religious, royal, military, unesco, iconic, tall, massive, waterfall, volcanic, coastal, island, mountain-top
- Tourism: top-10-visited, bucket-list, wonder-of-world`);

  // ── Logos ──
  const logoSlugs = [
    "tech-companies", "food-beverage", "car-brands", "fashion-brands",
    "japanese-companies", "american-companies", "european-companies",
    "entertainment-companies"
  ];
  const logos = await getItemsBySlugs(logoSlugs);
  await tagPool("logos", logos, `Tag each company/brand with ALL applicable tags:
- Industry: tech, food, beverage, automotive, fashion, luxury, finance, entertainment, retail, sports, telecom, social-media, gaming, streaming, fast-food, coffee, electronics, software, hardware, aerospace
- Region: american, european, japanese, korean, chinese, british, german, french, italian, swedish, swiss
- Era: founded-pre-1950, founded-1950-2000, founded-post-2000
- Size: mega-corp, large, startup
- Traits: consumer-facing, iconic-logo, red-logo, blue-logo, green-logo, minimal-logo, text-logo, symbol-logo, animal-logo
- Category: food-chain, car-maker, phone-maker, search-engine, social-network, streaming-service, sportswear, luxury-brand, bank, airline`);

  // ── Monsters ──
  const monsterSlugs = [
    "classic-monsters", "the-undead", "wears-a-mask", "not-from-earth",
    "bigger-than-building", "looks-human", "carries-weapon",
    "supernatural-powers", "videogame-monsters", "slasher-villains"
  ];
  const monsters = await getItemsBySlugs(monsterSlugs);
  await tagPool("monsters", monsters, `Tag each movie monster / horror villain / creature with ALL applicable tags:
- Type: vampire, werewolf, zombie, ghost, demon, alien, kaiju, slasher, robot, cyborg, mutant, witch, undead, spirit, parasite, shapeshifter, dragon, giant-monster
- Origin medium: classic-horror, modern-horror, sci-fi, fantasy, video-game, anime, tv-show, comic-book
- Era: pre-1960, 1960s-1970s, 1980s, 1990s, 2000s, 2010s-2020s
- Traits: humanoid, giant, wears-mask, uses-weapon, claws, fangs, tentacles, wings, supernatural, mechanical, intelligent, mindless, immortal, shapeshifter
- Franchise: use franchise name (e.g. "alien-franchise", "friday-the-13th", "halloween", "godzilla", "lord-of-the-rings", "resident-evil", "stranger-things", "star-wars")
- Scariness: creepy, terrifying, iconic, campy, tragic
- Powers: super-strength, flight, telekinesis, mind-control, regeneration, invisibility, fire-breath, acid`);

  // ── Fictional characters (HP + Disney + Big Cats) ──
  const fictionalSlugs = [
    "harry-potter-characters", "disney-princesses", "big-cats"
  ];
  const fictional = await getItemsBySlugs(fictionalSlugs);
  await tagPool("fictional", fictional, `Tag each fictional character with ALL applicable tags:
- Franchise: harry-potter, disney, pixar, marvel, dc, lord-of-the-rings, star-wars, nintendo, anime, studio-ghibli, dreamworks
- Role: hero, villain, sidekick, mentor, royalty, anti-hero, comic-relief
- Gender: male, female, non-human
- Traits: magic-user, warrior, scientist, animal, robot, alien, human, elf, dwarf, wizard, witch, princess, prince, king, queen
- Powers: magic, super-strength, flight, shapeshifting, telekinesis, none
- Setting: medieval, modern, futuristic, fantasy-world, space, underwater
- Age: child, young-adult, adult, elderly, ageless
- Visual: wears-hat, wears-cape, wears-mask, wears-glasses, has-scar, has-beard, distinctive-hair, animal-companion`);

  console.log("\n=== Migration complete! ===");

  // Print summary
  const summary = await db.execute(sql`
    SELECT pool, count(*) as cnt FROM pool_items GROUP BY pool ORDER BY pool
  `);
  console.log("\nPool summary:");
  for (const row of summary as any) {
    console.log(`  ${row.pool}: ${row.cnt} items`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
