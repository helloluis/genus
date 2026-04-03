import { db, categories, selections } from "./index.js";

async function seed() {
  console.log("Seeding database...");

  // Insert a test category
  const [category] = await db
    .insert(categories)
    .values({
      name: "US Presidents",
      slug: "us-presidents",
      difficulty: 1,
      isCurrentEvents: false,
      verified: true,
    })
    .returning();

  console.log(`Created category: ${category.name} (id: ${category.id})`);

  // Correct selections
  const correctItems = [
    "George Washington",
    "Abraham Lincoln",
    "Theodore Roosevelt",
    "John F. Kennedy",
    "Barack Obama",
    "Franklin D. Roosevelt",
    "Thomas Jefferson",
    "Harry Truman",
    "Dwight Eisenhower",
    "Ronald Reagan",
    "Bill Clinton",
    "Jimmy Carter",
    "Richard Nixon",
    "Lyndon B. Johnson",
    "Joe Biden",
  ];

  // Distractors (not US Presidents)
  const distractors = [
    "Winston Churchill",
    "Emmanuel Macron",
    "Angela Merkel",
    "Justin Trudeau",
    "Narendra Modi",
    "Shinzo Abe",
    "Boris Johnson",
    "Vladimir Putin",
    "Xi Jinping",
    "Tony Blair",
  ];

  const selectionValues = [
    ...correctItems.map((label) => ({
      categoryId: category.id,
      label,
      isCorrect: true,
      verified: true,
    })),
    ...distractors.map((label) => ({
      categoryId: category.id,
      label,
      isCorrect: false,
      verified: true,
    })),
  ];

  await db.insert(selections).values(selectionValues);
  console.log(
    `Inserted ${correctItems.length} correct + ${distractors.length} distractors`
  );

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
