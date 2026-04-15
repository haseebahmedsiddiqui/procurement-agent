import "dotenv/config";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";
import { Vendor } from "../models/Vendor";
import { Category } from "../models/Category";
import { vendorsSeed } from "./vendors";
import { categoriesSeed } from "./categories";

// Pick up .env.local explicitly (Next.js loads it for the dev server, but
// standalone scripts run via tsx do not unless we point dotenv at it).
loadEnv({ path: ".env.local", override: true });

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/procurement";

async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  // Seed categories
  console.log("Seeding categories...");
  for (const cat of categoriesSeed) {
    await Category.findOneAndUpdate({ slug: cat.slug }, cat, { upsert: true });
  }
  console.log(`  ${categoriesSeed.length} categories seeded.`);

  // Seed vendors
  console.log("Seeding vendors...");
  for (const vendor of vendorsSeed) {
    await Vendor.findOneAndUpdate({ slug: vendor.slug }, vendor, {
      upsert: true,
    });
  }
  console.log(`  ${vendorsSeed.length} vendors seeded.`);

  console.log("Seed complete!");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
