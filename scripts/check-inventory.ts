import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { connectDB } = await import("../src/lib/db/connection");
  const { InventoryItem } = await import("../src/lib/db/models/InventoryItem");
  await connectDB();

  const total = await InventoryItem.countDocuments({});
  const active = await InventoryItem.countDocuments({ isActive: true });
  const masked = await InventoryItem.countDocuments({ isMasked: true });
  const withRank = await InventoryItem.countDocuments({ rank: { $ne: null } });
  const withCost = await InventoryItem.countDocuments({
    derivedUnitCost: { $ne: null, $gt: 0 },
  });

  console.log(`Total items:        ${total}`);
  console.log(`Active:             ${active}`);
  console.log(`Masked:             ${masked}`);
  console.log(`With rank A-E:      ${withRank}`);
  console.log(`With unit cost:     ${withCost}`);

  console.log("\n--- 18CUMIN ---");
  console.log(JSON.stringify(await InventoryItem.findOne({ itemCode: "18CUMIN" }).lean(), null, 2));

  console.log("\n--- 03GE21 ---");
  console.log(JSON.stringify(await InventoryItem.findOne({ itemCode: "03GE21" }).lean(), null, 2));

  console.log("\n--- Top 5 by PYR sales ---");
  const top = await InventoryItem.find({}, {
    itemCode: 1,
    description: 1,
    "sales.pyr.salesUsd": 1,
    "sales.pyr.units": 1,
    derivedUnitCost: 1,
    rank: 1,
  }).sort({ "sales.pyr.salesUsd": -1 }).limit(5).lean();
  for (const r of top) {
    console.log(
      `  ${r.itemCode.padEnd(14)} rank=${r.rank ?? "-"} sales=$${r.sales?.pyr?.salesUsd?.toFixed(2) ?? "0"} units=${r.sales?.pyr?.units ?? 0} unitCost=$${r.derivedUnitCost?.toFixed(2) ?? "-"} — ${r.description}`
    );
  }

  const mongoose = await import("mongoose");
  await mongoose.default.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
