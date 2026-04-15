import mongoose, { Schema, type InferSchemaType } from "mongoose";

const vendorMappingSchema = new Schema(
  {
    productId: { type: String, required: true },
    productIdType: { type: String, required: true },
    searchQuery: { type: String, required: true },
    productUrl: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false }
);

const itemSchema = new Schema(
  {
    rfqDescription: { type: String, required: true, index: true },
    normalizedName: { type: String, required: true, index: true },
    impaCode: { type: String, index: true },
    category: {
      type: String,
      required: true,
      enum: ["stationery", "deck_engine", "galley_kitchen"],
      index: true,
    },
    vendors: {
      type: Map,
      of: vendorMappingSchema,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound index for fast dictionary lookups
itemSchema.index({ normalizedName: 1, category: 1 });
itemSchema.index({ impaCode: 1, category: 1 });
// Dictionary list page sorts by updatedAt desc, often filtered by category.
itemSchema.index({ updatedAt: -1 });
itemSchema.index({ category: 1, updatedAt: -1 });

export type ItemDocument = InferSchemaType<typeof itemSchema>;

export const Item =
  mongoose.models.Item || mongoose.model("Item", itemSchema);
