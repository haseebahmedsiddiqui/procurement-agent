import mongoose, { Schema, type InferSchemaType } from "mongoose";

const rfqItemSchema = new Schema(
  {
    lineNumber: { type: Number, required: true },
    description: { type: String, required: true },
    impaCode: { type: String },
    quantity: { type: Number, required: true },
    unit: { type: String, default: "EA" },
    notes: { type: String },
  },
  { _id: false }
);

const rfqSchema = new Schema(
  {
    filename: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
    items: [rfqItemSchema],
    detectedCategory: {
      type: String,
      enum: ["stationery", "deck_engine", "galley_kitchen", "mixed"],
      default: "stationery",
    },
    categoryConfidence: { type: Number, default: 0 },
    selectedVendors: [{ type: String }],
    status: {
      type: String,
      enum: ["uploaded", "processing", "completed", "failed"],
      default: "uploaded",
    },
  },
  { timestamps: true }
);

rfqSchema.index({ status: 1, uploadedAt: -1 });
// History list page sorts by uploadedAt desc with no status filter
rfqSchema.index({ uploadedAt: -1 });

export type RFQDocument = InferSchemaType<typeof rfqSchema>;

export const RFQ =
  mongoose.models.RFQ || mongoose.model("RFQ", rfqSchema);
