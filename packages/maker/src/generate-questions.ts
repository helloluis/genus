import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, poolItems, questions } from "@genus/db";
import { sql } from "drizzle-orm";

/**
 * Generate questions by analyzing which tags have enough items to form a round.
 * A valid question needs: ≥1 item with the tag (correct) and ≥15 without (distractors).
 */
async function main() {
  console.log("\n=== Generating Questions from Tags ===\n");

  // Get all tag counts per pool
  const pools = ["animals", "dogs", "landmarks", "logos", "monsters", "fictional"];

  interface QuestionDef {
    text: string;
    pool: string;
    correctTag: string;
    difficulty: number;
    hideLabels: boolean;
  }

  const allQuestions: QuestionDef[] = [];

  for (const pool of pools) {
    const items = await db.execute(
      sql`SELECT id, label, tags FROM pool_items WHERE pool = ${pool}`
    );

    // Count items per tag
    const tagCounts: Record<string, number> = {};
    const totalItems = (items as any).length;

    for (const item of items as any) {
      const tags: string[] = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Valid questions: tag has 1-8 correct items AND at least 15 without it
    const validTags: { tag: string; count: number; nonCount: number }[] = [];
    for (const [tag, count] of Object.entries(tagCounts)) {
      const nonCount = totalItems - count;
      if (count >= 1 && count <= 8 && nonCount >= 15) {
        validTags.push({ tag, count, nonCount });
      }
    }

    console.log(`${pool}: ${totalItems} items, ${Object.keys(tagCounts).length} unique tags, ${validTags.length} viable question tags`);

    // Create fun question text for each viable tag
    for (const { tag, count } of validTags) {
      const text = tagToQuestionText(tag, pool);
      if (!text) continue;

      const difficulty = count <= 2 ? 1 : count <= 5 ? 2 : 3;
      const hideLabels = pool === "dogs" && count <= 3; // Single-breed dog questions hide labels

      allQuestions.push({ text, pool, correctTag: tag, difficulty, hideLabels });
    }
  }

  // Deduplicate by text
  const seen = new Set<string>();
  const unique = allQuestions.filter((q) => {
    const key = `${q.pool}:${q.correctTag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nInserting ${unique.length} questions...`);

  for (const q of unique) {
    await db.insert(questions).values({
      text: q.text,
      pool: q.pool,
      correctTag: q.correctTag,
      difficulty: q.difficulty,
      hideLabels: q.hideLabels,
    });
  }

  // Print summary
  const summary = await db.execute(
    sql`SELECT pool, count(*) as cnt FROM questions GROUP BY pool ORDER BY pool`
  );
  console.log("\nQuestions per pool:");
  for (const row of summary as any) {
    console.log(`  ${row.pool}: ${row.cnt}`);
  }

  console.log("\nDone!");
  process.exit(0);
}

/** Convert a tag into fun, player-facing question text */
function tagToQuestionText(tag: string, pool: string): string | null {
  // ── Animals ──
  const animalMap: Record<string, string> = {
    "mammal": "Feeds Milk to Babies",
    "bird": "Has Feathers",
    "reptile": "Cold-Blooded & Scaly",
    "amphibian": "Land AND Water",
    "insect": "Has 6 Legs",
    "arachnid": "8 Legs!",
    "crustacean": "Has a Hard Shell & Claws",
    "mollusk": "Soft Body, No Bones",
    "fish": "Breathes Underwater",
    "tiny": "Fits in Your Hand",
    "massive": "Heavier Than You!",
    "heavier-than-a-car": "Heavier Than a Car!",
    "lighter-than-a-child": "Lighter Than a Toddler",
    "ocean": "Lives in the Ocean",
    "freshwater": "Found in Rivers & Lakes",
    "desert": "Desert Dwellers",
    "jungle": "Jungle Animal",
    "arctic": "Survives the Arctic",
    "savanna": "Roams the Savanna",
    "african": "Only in Africa!",
    "asian": "Found in Asia",
    "australian": "Only in Australia!",
    "south-american": "South American Native",
    "carnivore": "Meat Eater!",
    "herbivore": "Plant Eater Only",
    "omnivore": "Eats Everything!",
    "no-legs": "No Legs!",
    "2-legs": "Walks on Two Legs",
    "6-legs": "Has 6 Legs",
    "8-legs": "8 Legs!",
    "many-legs": "Too Many Legs!",
    "venomous": "Venomous!",
    "poisonous": "Don't Touch!",
    "endangered": "Going Extinct!",
    "nocturnal": "Only Comes Out at Night",
    "can-fly": "They Can Fly!",
    "flightless": "Can't Fly (But Has Wings)",
    "has-shell": "Has a Shell",
    "has-horns": "Has Horns",
    "has-tusks": "Has Tusks!",
    "spotted": "Covered in Spots",
    "striped": "Wears Stripes",
    "lays-eggs": "They Lay Eggs",
    "marsupial": "Marsupials!",
    "aquatic": "Lives in Water",
    "domesticated": "Can Be a Pet",
    "apex-predator": "Top of the Food Chain",
    "slow": "Slower Than You!",
    "very-fast": "Faster Than a Car!",
    "camouflage": "Masters of Disguise",
    "bioluminescent": "Glows in the Dark!",
    "solitary": "Loner Animal",
    "pack-animal": "Travels in Packs",
    "migratory": "Long Distance Traveler",
  };

  // ── Dogs ──
  const dogMap: Record<string, string> = {
    "tiny": "Tiny Dogs",
    "small": "Small Dogs",
    "large": "Big Dogs",
    "giant": "Giant Dogs!",
    "sporting": "Sporting Breeds",
    "working": "Working Dogs",
    "herding": "Herding Breeds",
    "terrier": "Terriers",
    "toy": "Toy Breeds",
    "hound": "Hound Dogs",
    "japanese": "Japanese Breeds",
    "german": "German Breeds",
    "british": "British Breeds",
    "french": "French Breeds",
    "fluffy": "Fluffy Dogs!",
    "short-hair": "Short-Haired Dogs",
    "curly": "Curly Coated",
    "hairless": "Hairless Dogs!",
    "spotted": "Spotted Dogs",
    "golden": "Golden Coated",
    "guard-dog": "Guard Dogs",
    "family-friendly": "Family Friendly",
    "hypoallergenic": "Hypoallergenic!",
    "athletic": "Athletic Breeds",
    "calm": "Calm & Gentle",
    "energetic": "Full of Energy!",
    "intelligent": "Smartest Breeds",
    "flat-face": "Flat-Faced Dogs",
    "long-ears": "Long Ears!",
    "wrinkled": "Wrinkly!",
    "muscular": "Muscular Dogs",
    "slim": "Slim & Sleek",
  };

  // ── Landmarks ──
  const landmarkMap: Record<string, string> = {
    "north-america": "Found in North America",
    "europe": "Found in Europe",
    "asia": "Found in Asia",
    "south-america": "Found in South America",
    "africa": "Found in Africa",
    "oceania": "Found in Oceania",
    "middle-east": "Found in the Middle East",
    "usa": "In the USA",
    "france": "In France",
    "india": "In India",
    "italy": "In Italy",
    "japan": "In Japan",
    "egypt": "In Egypt",
    "china": "In China",
    "uk": "In the UK",
    "spain": "In Spain",
    "ancient": "Over 1000 Years Old!",
    "medieval": "Built in Medieval Times",
    "modern": "Built After 1800",
    "contemporary": "Built After 1950",
    "tower": "It's a Tower!",
    "bridge": "It's a Bridge!",
    "temple": "Place of Worship",
    "church": "It's a Church!",
    "mosque": "It's a Mosque!",
    "palace": "Fit for a King!",
    "castle": "It's a Castle!",
    "ruins": "Ancient Ruins",
    "natural-wonder": "Made by Nature!",
    "unesco": "UNESCO World Heritage",
    "tall": "Taller Than 100 Meters",
    "religious": "Religious Site",
    "wonder-of-world": "Wonder of the World!",
  };

  // ── Logos ──
  const logoMap: Record<string, string> = {
    "tech": "Tech Company",
    "food": "Food Brand",
    "beverage": "Drink Brand",
    "fast-food": "Fast Food Chain",
    "automotive": "Car Company",
    "fashion": "Fashion Brand",
    "luxury": "Luxury Brand",
    "entertainment": "Entertainment Company",
    "social-media": "Social Media Platform",
    "streaming": "Streaming Service",
    "gaming": "Gaming Company",
    "sportswear": "Sports Brand",
    "american": "Made in America",
    "european": "Made in Europe",
    "japanese": "Made in Japan",
    "korean": "Made in Korea",
    "german": "Made in Germany",
    "founded-pre-1950": "Founded Before 1950",
    "founded-post-2000": "Born After 2000",
    "red-logo": "Red Logo!",
    "blue-logo": "Blue Logo!",
    "green-logo": "Green Logo!",
  };

  // ── Monsters ──
  const monsterMap: Record<string, string> = {
    "vampire": "Vampires!",
    "zombie": "Zombies!",
    "ghost": "Ghosts!",
    "demon": "Demons!",
    "alien": "From Outer Space!",
    "kaiju": "Bigger Than a Building!",
    "slasher": "Slasher Villains",
    "robot": "Robots & Machines",
    "cyborg": "Part Human, Part Machine",
    "undead": "The Undead!",
    "giant-monster": "Giant Monsters!",
    "classic-horror": "Classic Horror",
    "modern-horror": "Modern Horror",
    "sci-fi": "Not From This Planet",
    "fantasy": "Fantasy Creatures",
    "video-game": "From a Video Game",
    "anime": "From Anime",
    "humanoid": "Looks Human... Almost",
    "wears-mask": "Wears a Mask",
    "uses-weapon": "Carries a Weapon",
    "supernatural": "Supernatural Powers",
    "giant": "Bigger Than a Building!",
    "intelligent": "Evil Genius",
    "immortal": "Can't Be Killed!",
    "pre-1960": "Over 100 Years Old!",
    "terrifying": "Pure Nightmare Fuel",
    "iconic": "Horror Icons",
  };

  // ── Fictional ──
  const fictionalMap: Record<string, string> = {
    "harry-potter": "Harry Potter Character",
    "disney": "Disney Character",
    "pixar": "Pixar Character",
    "marvel": "Marvel Character",
    "dc": "DC Character",
    "lord-of-the-rings": "Middle-Earth Character",
    "star-wars": "Star Wars Character",
    "nintendo": "Nintendo Character",
    "studio-ghibli": "Studio Ghibli Character",
    "hero": "The Good Guys",
    "villain": "The Bad Guys",
    "sidekick": "The Sidekicks",
    "royalty": "Royalty!",
    "magic-user": "Uses Magic!",
    "wizard": "Wizards!",
    "witch": "Witches!",
    "princess": "Princesses!",
    "animal": "Animal Characters",
    "non-human": "Not Human!",
    "wears-glasses": "Wears Glasses",
    "has-beard": "Has a Beard",
    "distinctive-hair": "Famous Hair!",
    "wears-cape": "Wears a Cape!",
    "warrior": "Warriors & Fighters",
    "mentor": "The Wise Mentor",
  };

  const maps: Record<string, Record<string, string>> = {
    animals: animalMap,
    dogs: dogMap,
    landmarks: landmarkMap,
    logos: logoMap,
    monsters: monsterMap,
    fictional: fictionalMap,
  };

  return maps[pool]?.[tag] ?? null;
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
