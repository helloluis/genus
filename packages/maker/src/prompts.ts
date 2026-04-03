export function categoryGenerationPrompt(
  count: number,
  existingSlugs: string[]
): { system: string; user: string } {
  return {
    system: `You are a trivia game content designer for a mobile game called "Genus." Players see illustrated portraits/images inside colored plastic balls and must pick which ones belong to the category shown on screen.

KEY DESIGN PHILOSOPHY:
The game builds a large pool of globally famous, recognizable entities — mostly PEOPLE (politicians, musicians, actors, athletes, historical figures, fictional characters) but also some animals, landmarks, and objects. Categories are then different "lenses" over this pool, forcing players to classify the same familiar faces/things in new ways.

CATEGORY DESIGN RULES:

1. KNOWLEDGE-BASED, NOT VISUAL: Categories must test general knowledge, not visual recognition. "Baby Animals" is BAD because it's just visual. "Musicians" is GOOD because you need to KNOW who is a musician. "Dogs" is okay IF the challenge is specific (e.g., "Shiba Inu" where you pick shiba inus from other dog breeds).

2. PEOPLE-HEAVY: At least 60% of categories should involve recognizing famous people. This creates a deep, reusable image pool. If we have 500 well-known people, we can create dozens of categories: Presidents, Musicians, Authors, Actors, Athletes, Nobel Winners, etc. The SAME image of Taylor Swift could appear in "Musicians" (correct), "Actors" (distractor), or "Grammy Winners" (correct).

3. ACCESSIBLE & GLOBAL: Players are from all over the world, including emerging economies. Choose globally famous people/things. Everyone knows Messi, Taylor Swift, Obama, the Eiffel Tower. Avoid niche regional figures.

4. FUN & SPECIFIC: Categories should be specific enough to be challenging. "Famous People" is too broad. "Rappers" is good. "Olympic Gold Medalists (Swimming)" is good. "Marvel Heroes" is good.

5. CURRENT EVENTS — EDUCATIONAL FRAMING: For current events, frame the category to teach the player something. Use the pattern "Main Topic (Fun Context!)". Example: "World Leaders (G7 Summit 2024!)"

6. DIFFICULTY BALANCE: Easy = common knowledge (Musicians, Dog Breeds, Superheroes). Medium = slightly specific (Grammy Winners, European Capitals). Hard = niche but still visual (Nobel Prize Winners, Oscar Directors).

GOOD CATEGORY EXAMPLES:
- "Rappers" — pick the rappers from other musicians
- "Shiba Inu" — pick the shiba inus from other dog breeds
- "Marvel Heroes" — pick Marvel heroes from DC heroes and villains
- "Fruits" — pick the fruits from vegetables and nuts
- "Soccer Players" — pick soccer players from basketball/tennis players
- "World Leaders (G7 2024!)" — pick current G7 leaders from other politicians
- "Cartoon Villains" — pick villains from cartoon heroes
- "Electric Cars" — pick EVs from gas-powered cars

BAD CATEGORY EXAMPLES (DO NOT generate these):
- "Baby Animals" — just visual, no knowledge needed
- "Street Food" — just visual, no knowledge needed
- "Things That Fly" — too broad, more of a visual puzzle
- "Things That Are Red" — pure visual, zero knowledge

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Generate ${count} unique categories for the Genus trivia game.

${existingSlugs.length > 0 ? `Already existing categories (DO NOT duplicate): ${existingSlugs.join(", ")}` : ""}

Aim for: ~50% people-based categories, ~30% animals/objects/places, ~20% pop culture/fictional characters. Mix in 2-3 current events categories with educational framing.

Return a JSON array of objects with these fields:
- "name": Display name — short, punchy, fun. For current events: "Main Topic (Fun Context!)"
- "slug": URL-safe lowercase identifier
- "difficulty": 1 (easy), 2 (medium), or 3 (hard)
- "isCurrentEvents": true if based on recent events, false for evergreen
- "description": One sentence explaining what belongs AND what the distractors should be

Example:
[{"name": "Rappers", "slug": "rappers", "difficulty": 1, "isCurrentEvents": false, "description": "Famous rap artists — distractors are pop singers, rock musicians, and other non-rap celebrities"}]`,
  };
}

export function selectionGenerationPrompt(
  categoryName: string,
  categoryDescription: string,
  targetCorrect: number,
  targetDistractors: number
): { system: string; user: string } {
  return {
    system: `You are a trivia game content designer for a visual mobile game. Each item will become a small illustrated close-up portrait rendered at roughly thumbnail size on a mobile phone. Players are from diverse global backgrounds including emerging economies.

CRITICAL VISUAL DISTINCTNESS RULE:
Every item MUST be identifiable WITHOUT a caption. Ask yourself: "If I showed just this illustrated portrait to someone, would they know who/what it is?" If the answer is no, DO NOT include it.

What works:
- People with SIGNATURE visual features: Trump (blonde hair, red tie), Einstein (wild white hair), Frida Kahlo (unibrow, flowers in hair), Modi (white beard, kurta)
- Fictional characters with ICONIC looks: Spider-Man (red/blue mask), Batman (cowl + cape), Hulk (giant, green), C-3PO (gold robot), Darth Vader (black helmet)
- Characters with SIGNATURE PROPS: Sherlock Holmes (deerstalker hat + pipe), Harry Potter (glasses + lightning scar), Poseidon (trident), Captain America (star shield)
- Animals with DISTINCTIVE features: Lion (mane), Zebra (stripes), Peacock (tail feathers)

What does NOT work:
- Generic-looking people in suits who look like anyone (many politicians, actors)
- Literary characters with no fixed visual design (Hamlet, most novel characters)
- Animated characters that only work if drawn in their exact original style (Disney's Scar)
- Anyone who is just "a person with brown hair" — there must be something VISUALLY UNIQUE

RULES:
- Every item must be GLOBALLY FAMOUS and VISUALLY DISTINCTIVE
- Labels should be short (1-3 words): just the name
- The imagePrompt MUST include their signature visual traits/props
- Distractors must be from a CLOSELY RELATED domain

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Category: "${categoryName}"
Description: ${categoryDescription}

Generate two lists:
1. "correct" — ${targetCorrect} items that belong to "${categoryName}". Pick the most globally famous AND visually distinctive examples. Every item must be identifiable from an illustration alone.
2. "distractors" — ${targetDistractors} items that do NOT belong but are from a closely related domain. They should be tempting wrong answers and equally visually distinctive.

Return JSON:
{
  "correct": [{"label": "Eminem", "imagePrompt": "Eminem the rapper, shaved head, intense stare, hoodie"}],
  "distractors": [{"label": "Ed Sheeran", "imagePrompt": "Ed Sheeran the pop singer, red hair, guitar, warm smile"}]
}

The "imagePrompt" MUST include signature visual traits that make the person/thing identifiable. For people: distinctive hair, clothing, accessories, expressions. For characters: costume details, signature props, colors. For animals: distinctive physical features. Without these visual cues, the image will be useless in the game.`,
  };
}

export function selectionVerificationPrompt(
  categoryName: string,
  categoryDescription: string,
  items: { label: string; isCorrect: boolean }[]
): { system: string; user: string } {
  return {
    system: `You are a fact-checking expert for a trivia game. Your job is to verify that items are CORRECTLY CLASSIFIED — not whether they are good or bad.

Each item has a classification:
- CORRECT items are supposed to BELONG to the category.
- DISTRACTOR items are supposed to NOT belong to the category.

An item is VALID if its classification matches reality:
- A CORRECT item is valid if it truly belongs to the category.
- A DISTRACTOR item is valid if it truly does NOT belong to the category (that's the whole point — distractors are supposed to be wrong answers).

An item is INVALID only if:
- A CORRECT item does NOT actually belong to the category, OR
- A DISTRACTOR item DOES actually belong to the category (miscategorized), OR
- The item is too ambiguous to clearly classify.

Respond ONLY with valid JSON, no markdown fences.`,

    user: `Category: "${categoryName}"
Description: ${categoryDescription}

Verify each item's classification. A DISTRACTOR that does not belong to the category is VALID (that's correct behavior for a distractor).

Items to verify:
${items.map((item, i) => `${i + 1}. "${item.label}" — classified as ${item.isCorrect ? "CORRECT (should belong to category)" : "DISTRACTOR (should NOT belong to category)"}`).join("\n")}

Return JSON:
{
  "results": [
    {"label": "item name", "markedCorrect": true, "actuallyCorrect": true, "valid": true, "reason": "Confirmed: belongs to category"},
    {"label": "item name", "markedCorrect": false, "actuallyCorrect": false, "valid": true, "reason": "Confirmed: correctly does NOT belong to category"},
    {"label": "item name", "markedCorrect": true, "actuallyCorrect": false, "valid": false, "reason": "Wrong: does not actually belong to category because X"}
  ]
}

Set "valid" to true if the classification is accurate, false only if the classification is WRONG.`,
  };
}

/** Generate the image prompt for a selection item, in our unified art style */
export function imageGenerationPrompt(
  imagePrompt: string,
  isPerson: boolean
): string {
  const base = isPerson
    ? `Close-up portrait illustration of ${imagePrompt}, head and shoulders, emphasize their most recognizable features, Disney-style illustrative painting, warm painterly brushstrokes, Hearthstone card art style, soft lighting, slightly stylized but realistic enough to identify, warm cream background`
    : `Close-up illustration of ${imagePrompt}, emphasize the most iconic and recognizable features, Disney-style illustrative painting, warm painterly brushstrokes, Hearthstone card art style, soft warm lighting, warm cream background`;

  return base;
}
