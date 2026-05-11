import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { matchInventoryItem } = await import("../src/lib/inventory/matcher");

  const queries = [
    { rfqDescription: "Ground cumin powder 1 lb", normalizedName: "ground cumin powder 1lb" },
    { rfqDescription: "Bay leaves whole", normalizedName: "whole bay leaves" },
    { rfqDescription: "Fresh eggs dozen", normalizedName: "fresh eggs medium dozen" },
    { rfqDescription: "Spring water 1.5 liter", normalizedName: "spring water 1.5 litre" },
    { rfqDescription: "Stapler heavy duty office", normalizedName: "office stapler heavy duty" },
    { rfqDescription: "Pirate-themed party hats", normalizedName: "pirate party hats" },
  ];

  for (const q of queries) {
    console.log(`\nQuery: "${q.rfqDescription}"`);
    const result = await matchInventoryItem(q);
    if (!result.primary) {
      console.log(`  → no match (confidence=${result.confidence.toFixed(2)})`);
      console.log(`  reasoning: ${result.reasoning}`);
    } else {
      const p = result.primary;
      console.log(
        `  → [${p.itemCode}] "${p.description}" (UM=${p.unitOfMeasure}, rank=${p.rank}, cost=$${p.derivedUnitCost?.toFixed(2) ?? "?"}) — confidence ${result.confidence.toFixed(2)}`
      );
      console.log(`  reasoning: ${result.reasoning}`);
    }
  }

  const mongoose = await import("mongoose");
  await mongoose.default.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
