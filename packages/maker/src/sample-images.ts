import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFile, mkdir } from "fs/promises";
import { imageGenerationPrompt } from "./prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const OUTPUT_DIR = resolve(__dirname, "../../../samples/v2");

interface DashscopeResponse {
  output?: {
    choices?: {
      message?: {
        content?: { image?: string }[];
      };
    }[];
  };
  code?: string;
  message?: string;
}

async function generateImage(
  prompt: string,
  filename: string
): Promise<void> {
  console.log(`  ${filename}`);

  const body = {
    model: "qwen-image-2.0",
    input: {
      messages: [{ role: "user", content: [{ text: prompt }] }],
    },
    parameters: {
      size: "1536*1536",
      n: 1,
      prompt_extend: false,
      watermark: false,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as DashscopeResponse;
  if (data.code) {
    console.log(`    ERROR: ${data.code} — ${data.message}`);
    return;
  }

  const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;
  if (!imageUrl) { console.log(`    ERROR: No image URL`); return; }

  const imgRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  await writeFile(resolve(OUTPUT_DIR, filename), buffer);
  console.log(`    OK`);
}

const SAMPLES: { imagePrompt: string; isPerson: boolean; file: string }[] = [
  // Pixar Heroes
  { imagePrompt: "Woody the cowboy, yellow plaid shirt, red bandana, brown cowboy hat with badge, pull-string on back", isPerson: false, file: "pixar_woody.png" },
  { imagePrompt: "Buzz Lightyear space ranger, white green and purple space suit, clear helmet, wings on back", isPerson: false, file: "pixar_buzz.png" },
  { imagePrompt: "Mike Wazowski the monster, small round green body, one giant eye, thin arms and legs", isPerson: false, file: "pixar_mike.png" },
  { imagePrompt: "Wall-E the robot, boxy yellow rusted body, large binocular-like eyes, tank treads for feet", isPerson: false, file: "pixar_walle.png" },
  // Tennis Legends (with signature traits)
  { imagePrompt: "Rafael Nadal, sleeveless shirt, headband with long hair, intense grimace, holding tennis racket", isPerson: true, file: "tennis_nadal.png" },
  { imagePrompt: "Serena Williams, muscular build, signature beaded braids, colorful athletic dress, holding tennis racket", isPerson: true, file: "tennis_serena.png" },
  { imagePrompt: "John McEnroe, wild curly 80s hair, headband, angry shouting expression, holding vintage wooden racket", isPerson: true, file: "tennis_mcenroe.png" },
  // Distractors (athletes from other sports)
  { imagePrompt: "Muhammad Ali, boxing gloves, no shirt, floating like a butterfly pose, confident smile", isPerson: true, file: "distractor_ali.png" },
  { imagePrompt: "Usain Bolt, sprinting spikes, lightning bolt pose, tall lean runner, track uniform", isPerson: true, file: "distractor_bolt.png" },
  // Venomous Snakes
  { imagePrompt: "King Cobra with massive raised hood, distinct chevron pattern on neck, towering over other snakes", isPerson: false, file: "snake_cobra.png" },
  { imagePrompt: "Coral Snake with iconic red, yellow, and black ringed bands wrapping the body", isPerson: false, file: "snake_coral.png" },
  { imagePrompt: "Rattlesnake with segmented rattle tail clearly visible, diamond back pattern, coiled strike pose", isPerson: false, file: "snake_rattle.png" },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`\nGenerating ${SAMPLES.length} samples...\n`);
  for (const s of SAMPLES) {
    const prompt = imageGenerationPrompt(s.imagePrompt, s.isPerson);
    await generateImage(prompt, s.file);
  }
  console.log(`\nDone!\n`);
}

main().catch((err) => { console.error("Error:", err); process.exit(1); });
