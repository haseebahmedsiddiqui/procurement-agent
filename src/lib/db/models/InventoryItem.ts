import mongoose, { Schema, type InferSchemaType } from "mongoose";

const salesPeriodSchema = new Schema(
  {
    units: { type: Number, default: 0 },
    salesUsd: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    marginUsd: { type: Number, default: 0 },
    marginPct: { type: Number, default: 0 },
  },
  { _id: false }
);

const inventoryItemSchema = new Schema(
  {
    // Reserved for multi-tenant; null today.
    ownerId: { type: String, default: null, index: true },

    itemCode: { type: String, required: true },
    description: { type: String, default: "" },
    normalizedName: { type: String, default: "" },
    unitOfMeasure: { type: String, default: "" },

    // ABC volume class from the item listing report
    rank: { type: String, enum: ["A", "B", "C", "D", "E", null], default: null },
    primaryLocation: { type: String, default: null },

    lastSaleDate: { type: Date, default: null },

    sales: {
      mtd: { type: salesPeriodSchema, default: () => ({}) },
      ytd: { type: salesPeriodSchema, default: () => ({}) },
      pyr: { type: salesPeriodSchema, default: () => ({}) },
    },

    // PYR costUsd / PYR units — the most reliable historical unit cost
    derivedUnitCost: { type: Number, default: null },

    // PYR units > 0 OR last sale within ~18 months — used to mute dormant SKUs
    isActive: { type: Boolean, default: false, index: true },

    // True when description was ***...*** in the source ERP (retired/blocked)
    isMasked: { type: Boolean, default: false, index: true },

    // Sync bookkeeping
    lastSeenInImportId: { type: Schema.Types.ObjectId, ref: "InventoryImport" },
    importedAt: { type: Date, default: Date.now },
    sourceReports: [{ type: String, enum: ["item-listing", "sales-report"] }],
  },
  { timestamps: true }
);

// Natural key — unique per owner
inventoryItemSchema.index({ ownerId: 1, itemCode: 1 }, { unique: true });

// Match-time lookups
inventoryItemSchema.index({ ownerId: 1, normalizedName: 1 });
inventoryItemSchema.index({ description: "text" });

// Inventory list page sort
inventoryItemSchema.index({ ownerId: 1, isActive: -1, rank: 1, itemCode: 1 });

export type InventoryItemDocument = InferSchemaType<typeof inventoryItemSchema>;

export const InventoryItem =
  mongoose.models.InventoryItem ||
  mongoose.model("InventoryItem", inventoryItemSchema);
