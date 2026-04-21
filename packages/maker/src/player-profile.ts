/**
 * The Genus target player profile.
 *
 * This profile is injected into all content-generation LLM prompts so that
 * questions, renames, and new characters match our audience. Keep it terse —
 * it gets prepended to many system messages.
 */

export const PLAYER_PROFILE = `TARGET PLAYER PROFILE:
- Age 18-35, mostly male, global audience
- Average intelligence
- Often NOT a native English speaker — use simple, common words only
- Stronger in POP CULTURE (movies, video games, anime, sports, famous brands)
  than in geography, world history, or biology
- Prefers visual recognition over academic knowledge

VOCABULARY RULES FOR QUESTION TEXT:
- NEVER use technical/scientific terms. Examples:
  - BAD: "Brachycephalic", "Marsupial", "Bioluminescent", "Crustacean", "Arachnid"
  - GOOD: "Flat-Faced Dogs", "Has a Pouch!", "Glows in the Dark!", "Has Claws & Shell", "8 Legs!"
- NEVER use obscure geography terms. Examples:
  - BAD: "Found in Oceania", "In the Levant", "Built in Medieval Times"
  - GOOD: "In Australia & Pacific", "In the Middle East", "Very Old Buildings"
- NEVER use jargon that requires specialized knowledge. Examples:
  - BAD: "Hypoallergenic", "Flightless", "Contemporary"
  - GOOD: "Won't Make You Sneeze!", "Can't Fly!", "Built Recently"
- Keep questions to 2-5 words, punchy, fun, often with an exclamation mark
- Prefer descriptive phrasing over category names
- When in doubt: would someone with basic English and an average education
  in the Philippines, Brazil, India, or Egypt immediately get it? If not, rewrite.

CONTENT PRIORITIES (for NEW characters/items):
- HIGH PRIORITY: superheroes, anime, video game characters, cartoon characters,
  globally famous brand logos, globally famous landmarks
- MEDIUM PRIORITY: globally famous animals, famous dog breeds, pop music icons
- LOW PRIORITY: obscure world history, specialized biology, regional geography,
  literary figures outside pop adaptations`;
