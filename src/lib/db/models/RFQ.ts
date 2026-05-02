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

const vendorResultSchema = new Schema(
  {
    vendorSlug: { type: String, required: true },
    productName: { type: String },
    productId: { type: String },
    productUrl: { type: String },
    price: { type: Number },
    currency: { type: String },
    inStock: { type: Boolean },
    reviewCount: { type: Number },
    starRating: { type: Number },
    source: { type: String },
    error: { type: String },
  },
  { _id: false }
);

const searchRunItemSchema = new Schema(
  {
    itemIndex: { type: Number, required: true },
    results: [vendorResultSchema],
  },
  { _id: false }
);

const searchRunSchema = new Schema(
  {
    searchedAt: { type: Date, default: Date.now },
    vendorSlugs: [{ type: String }],
    totalResults: { type: Number, default: 0 },
    totalFailures: { type: Number, default: 0 },
    items: [searchRunItemSchema],
  },
  { _id: true }
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
    searchRuns: [searchRunSchema],
  },
  { timestamps: true }
);

rfqSchema.index({ status: 1, uploadedAt: -1 });
// History list page sorts by uploadedAt desc with no status filter
rfqSchema.index({ uploadedAt: -1 });

export type RFQDocument = InferSchemaType<typeof rfqSchema>;

export const RFQ =
  mongoose.models.RFQ || mongoose.model("RFQ", rfqSchema);
