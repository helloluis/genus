import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { generateAll } from "./generator.js";
import { checkAllUnverified } from "./checker.js";

const command = process.argv[2];

async function main() {
  switch (command) {
    case "generate": {
      const count = parseInt(process.argv[3] || "5", 10);
      await generateAll(count);
      break;
    }
    case "check": {
      await checkAllUnverified();
      break;
    }
    case "pipeline": {
      const count = parseInt(process.argv[3] || "5", 10);
      await generateAll(count);
      await checkAllUnverified();
      break;
    }
    default:
      console.log("Usage: tsx src/index.ts <generate|check|pipeline> [count]");
      console.log("  generate [count]  - Generate categories and selections");
      console.log("  check             - Verify all unverified categories");
      console.log("  pipeline [count]  - Generate then check");
      process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
