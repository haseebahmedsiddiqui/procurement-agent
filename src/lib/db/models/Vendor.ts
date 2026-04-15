import mongoose, { Schema, type InferSchemaType } from "mongoose";

const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    category: {
      type: String,
      required: true,
      enum: ["stationery", "deck_engine", "galley_kitchen"],
      index: true,
    },
    enabled: { type: Boolean, default: true },

    // Connection config
    baseUrl: { type: String, required: true },
    searchUrlPattern: { type: String, required: true },

    // Auth config
    authRequired: { type: Boolean, default: false },
    authType: { type: String, enum: ["playwright", "none"], default: "none" },
    loginUrl: { type: String },
    dashboardUrl: { type: String },
    sessionMaxAgeHours: { type: Number, default: 168 },

    // Scraping strategy
    preferredStrategy: {
      type: String,
      enum: ["http", "playwright"],
      default: "http",
    },
    needsJsRendering: { type: Boolean, default: false },
    rateLimitMs: { type: Number, default: 2000 },

    // LLM hints
    extractionHints: { type: String, default: "" },
    searchQueryTemplate: { type: String, default: "" },

    // Per-vendor price cache freshness (hours)
    cacheFreshnessHours: { type: Number, default: 24 },

    // Metadata
    lastHealthCheck: { type: Date },
    healthStatus: {
      type: String,
      enum: ["healthy", "degraded", "down"],
      default: "healthy",
    },
  },
  { timestamps: true }
);

export type VendorDocument = InferSchemaType<typeof vendorSchema>;

export const Vendor =
  mongoose.models.Vendor || mongoose.model("Vendor", vendorSchema);
