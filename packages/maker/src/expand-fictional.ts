import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, poolItems } from "@genus/db";
import { eq } from "drizzle-orm";
import { MODEL } from "./dashscope.js";

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const CHAT_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      max_tokens: 16384,
      enable_thinking: false,
    }),
  });
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

interface CharacterEntry {
  label: string;
  tags: string[];
}

const EXISTING_LABELS = new Set<string>();

const TAG_SCHEMA = `
Tags should cover multiple dimensions so we can build many different questions:

FRANCHISE/SOURCE (pick all that apply):
  marvel, dc, star-wars, harry-potter, lord-of-the-rings, disney, pixar,
  studio-ghibli, nintendo, anime, video-game, tv-show, literature, mythology,
  dreamworks, cartoon-network, nickelodeon, sesame-street, muppets,
  sherlock-holmes, james-bond, doctor-who, game-of-thrones, marvel-mcu,
  dc-extended, x-men, avengers, spider-verse, batman-franchise,
  superman-franchise, final-fantasy, zelda-franchise, mario-franchise,
  pokemon, one-piece, naruto, dragon-ball, demon-slayer, jujutsu-kaisen,
  attack-on-titan, hunger-games, twilight, matrix, back-to-the-future,
  jurassic-park, indiana-jones, pirates-of-the-caribbean, frozen,
  toy-story, shrek, simpsons, family-guy, south-park, rick-and-morty,
  adventure-time, avatar-the-last-airbender, spongebob

ROLE:
  hero, villain, anti-hero, sidekick, mentor, ruler, trickster, comic-relief

GENDER: male, female, non-binary, robot, animal-character

SPECIES: human, alien, robot, elf, dwarf, hobbit, wizard, vampire, werewolf,
  god, demigod, mutant, android, cyborg, ghost, monster, animal-character, fairy

VISUAL TRAITS (for image recognition):
  wears-cape, wears-mask, wears-glasses, wears-hat, wears-armor, wears-crown,
  has-beard, has-long-hair, has-short-hair, bald, distinctive-hair,
  muscular, slim, tall, short, old, young, child,
  carries-weapon, carries-shield, carries-wand, carries-bow,
  red-costume, blue-costume, green-costume, black-costume, white-costume,
  gold-costume, purple-costume

ERA: classic, modern, 1980s, 1990s, 2000s, 2010s, 2020s, pre-1960

MEDIUM: live-action, animated, cgi, hand-drawn, stop-motion

POWER: super-strength, flight, magic, telepathy, speed, invisibility,
  shape-shifting, healing, elemental, technology, martial-arts, archery, genius

OTHER: royalty, princess, prince, king, queen, iconic, tragic, funny, scary,
  british, american, japanese, norse, greek-mythology, egyptian,
  space, underwater, medieval, futuristic, post-apocalyptic
`;

async function generateBatch(
  category: string,
  count: number,
  existingLabels: string[]
): Promise<CharacterEntry[]> {
  const system = `You are a trivia game content designer. Generate fictional characters for a visual recognition game.

RULES:
1. Characters must be GLOBALLY FAMOUS — recognizable worldwide
2. Characters must be VISUALLY DISTINCTIVE — identifiable from an illustrated portrait
3. Each character needs rich, accurate tags for building trivia questions
4. NO real people — only fictional characters
5. NO generic animals — only named fictional characters (e.g., "Simba" not "Lion")

${TAG_SCHEMA}

Respond ONLY with valid JSON array, no markdown fences.`;

  const user = `Generate ${count} fictional characters from: ${category}

ALREADY IN DATABASE (do NOT repeat): ${existingLabels.join(", ")}

Return JSON array:
[{"label": "Batman", "tags": ["dc", "batman-franchise", "hero", "male", "human", "wears-cape", "wears-mask", "wears-armor", "muscular", "dark-costume", "black-costume", "carries-weapon", "martial-arts", "genius", "technology", "rich", "iconic", "modern", "live-action", "animated", "american", "detective", "vigilante"]}]

Be thorough with tags — the more tags, the more questions we can generate.`;

  const raw = await callLLM(system, user);
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found");
    return JSON.parse(match[0]);
  } catch (e) {
    process.stdout.write(`  Parse error: ${(e as Error).message}\n`);
    return [];
  }
}

async function main() {
  // Get existing labels
  const existing = await db
    .select({ label: poolItems.label })
    .from(poolItems)
    .where(eq(poolItems.pool, "fictional"));
  for (const e of existing) EXISTING_LABELS.add(e.label);
  const existingList = [...EXISTING_LABELS];

  process.stdout.write(`\n=== Expanding Fictional Pool ===\n`);
  process.stdout.write(`Current: ${existingList.length} characters\n`);
  process.stdout.write(`Target: 200+ characters\n\n`);

  // Generate in themed batches for better variety
  const batches: [string, number][] = [
    ["DC Comics superheroes and villains (Batman, Superman, Joker, Lex Luthor, Wonder Woman villains, Flash, Green Lantern, Aquaman, etc.)", 25],
    ["Marvel Comics superheroes and villains NOT already in the database (Captain America, Thor, Iron Man, Spider-Man, Thanos, Loki, Black Widow, Hulk, Hawkeye, Scarlet Witch, etc.)", 25],
    ["Classic literature and theater characters (Sherlock Holmes, Sweeney Todd the Demon Barber, Romeo, Juliet, Dracula, Frankenstein's monster, Ebenezer Scrooge, Robin Hood, King Arthur, etc.)", 20],
    ["Star Wars characters (Luke Skywalker, Darth Vader, Princess Leia, Han Solo, Chewbacca, Boba Fett, Darth Maul, Obi-Wan, Palpatine, R2-D2, C-3PO, etc.)", 15],
    ["Anime and manga characters from globally famous series (Goku, Naruto, Luffy, Sailor Moon characters, Totoro, Pikachu, Ash Ketchum, Vegeta, etc.)", 20],
    ["Nintendo, PlayStation, and video game characters (Mario, Luigi, Peach, Bowser, Donkey Kong, Sonic, Kirby, Samus, Mega Man, Pac-Man, Crash Bandicoot, Master Chief, Kratos, Lara Croft, etc.)", 20],
    ["Pixar and DreamWorks animated film characters (Shrek, Donkey, Buzz Lightyear, Woody, Nemo, Dory, Mike Wazowski, Sully, Po the Panda, Toothless, etc.)", 15],
    ["TV cartoon and animated series characters (SpongeBob, Homer Simpson, Bugs Bunny, Mickey Mouse, Scooby-Doo, Tom & Jerry, Pinocchio, Peter Pan, Aang, Finn & Jake, etc.)", 15],
  ];

  let totalAdded = 0;

  for (const [category, count] of batches) {
    process.stdout.write(`\nGenerating: ${category.substring(0, 60)}... (${count})\n`);

    const characters = await generateBatch(category, count, existingList);

    let batchAdded = 0;
    for (const char of characters) {
      // Skip duplicates
      if (EXISTING_LABELS.has(char.label)) {
        process.stdout.write(`  SKIP (exists): ${char.label}\n`);
        continue;
      }

      await db.insert(poolItems).values({
        pool: "fictional",
        label: char.label,
        tags: char.tags,
        imageStatus: "pending",
      });

      EXISTING_LABELS.add(char.label);
      existingList.push(char.label);
      batchAdded++;
      process.stdout.write(`  + ${char.label} (${char.tags.length} tags)\n`);
    }

    process.stdout.write(`  Added ${batchAdded} from this batch\n`);
    totalAdded += batchAdded;
  }

  const finalCount = await db
    .select({ label: poolItems.label })
    .from(poolItems)
    .where(eq(poolItems.pool, "fictional"));

  process.stdout.write(`\n=== Done! Added ${totalAdded} characters. Total: ${finalCount.length} ===\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
