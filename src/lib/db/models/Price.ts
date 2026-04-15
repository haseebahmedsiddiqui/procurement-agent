import mongoose, { Schema, type InferSchemaType } from "mongoose";

const priceSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    vendorSlug: { type: String, required: true, index: true },
    price: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    pricePerUnit: { type: Number },
    url: { type: String, required: true },
    inStock: { type: Boolean, default: true },
    deliveryEstimate: { type: String },
    scrapedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Fast lookups: latest price per item per vendor
priceSchema.index({ itemId: 1, vendorSlug: 1, scrapedAt: -1 });

export type PriceDocument = InferSchemaType<typeof priceSchema>;

export const Price =
  mongoose.models.Price || mongoose.model("Price", priceSchema);
