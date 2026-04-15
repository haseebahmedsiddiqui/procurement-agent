import mongoose, { Schema, type InferSchemaType } from "mongoose";

const categorySchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      enum: ["stationery", "deck_engine", "galley_kitchen"],
    },
    name: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, required: true },
    defaultVendors: [{ type: String }],
    detectionKeywords: [{ type: String }],
  },
  { timestamps: true }
);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

export const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);
