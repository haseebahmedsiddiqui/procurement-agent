import mongoose, { Schema, type InferSchemaType } from "mongoose";

const matchFeedbackSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    vendorSlug: { type: String, required: true },
    originalMatch: {
      productName: { type: String },
      productId: { type: String },
      productUrl: { type: String },
      price: { type: Number },
      confidence: { type: Number },
    },
    action: {
      type: String,
      enum: ["confirmed", "rejected", "corrected"],
      required: true,
    },
    correctedProductId: { type: String },
    correctedProductUrl: { type: String },
  },
  { timestamps: true }
);

matchFeedbackSchema.index({ itemId: 1, vendorSlug: 1 });

export type MatchFeedbackDocument = InferSchemaType<typeof matchFeedbackSchema>;

export const MatchFeedback =
  mongoose.models.MatchFeedback ||
  mongoose.model("MatchFeedback", matchFeedbackSchema);
