import fs from "fs";
import path from "path";
import { parseRFQ } from "../src/lib/parsers/rfq-parser";

async function test() {
  const files = [
    "sample-rfq-stationery.xlsx",
    "sample-rfq-deck-engine.xlsx",
    "sample-rfq-galley.xlsx",
    "sample-rfq-mixed.xlsx",
  ];

  for (const file of files) {
    const filePath = path.join(process.cwd(), "exports", file);
    const buffer = fs.readFileSync(filePath);
    const result = await parseRFQ(buffer, file);

    console.log(`\n=== ${file} ===`);
    console.log(`Format: ${result.detectedFormat}`);
    console.log(`Items: ${result.totalItems}`);
    if (result.parseWarnings.length) {
      console.log(`Warnings: ${result.parseWarnings.join(", ")}`);
    }
    console.log("First 3 items:");
    result.items.slice(0, 3).forEach((item) => {
      console.log(
        `  #${item.lineNumber} | ${item.description} | qty:${item.quantity} ${item.unit}${item.impaCode ? ` | IMPA:${item.impaCode}` : ""}`
      );
    });
  }
}

test().catch(console.error);
