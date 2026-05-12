import mongoose, { Schema, type InferSchemaType } from "mongoose";

const inventoryMatchFeedbackSchema = new Schema(
  {
    // Reserved for multi-tenant; null today.
    ownerId: { type: String, default: null, index: true },

    // Canonical lookup keys from the RFQ line
    rfqDescription: { type: String, required: true, index: true },
    normalizedName: { type: String, default: null },
    impaCode: { type: String, default: null, index: true },

    // The SKU the user chose / approved
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
      index: true,
    },
    // Denormalized for fast display without an extra lookup
    itemCode: { type: String, required: true },

    // confirmed: user approved the auto-match
    // rejected:  user said this SKU is NOT a fit; matcher should skip it next time
    // manual:    user picked this SKU themselves via the inventory search popover
    action: {
      type: String,
      enum: ["confirmed", "rejected", "manual"],
      required: true,
    },
    // How the user arrived at this decision
    source: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    // Original AI confidence at the time of feedback (for "confirmed" / "rejected")
    confidence: { type: Number, default: null },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

// Primary lookup path — matcher first-pass uses this
inventoryMatchFeedbackSchema.index(
  { ownerId: 1, rfqDescription: 1, action: 1 }
);
// IMPA-based shortcut
inventoryMatchFeedbackSchema.index({ ownerId: 1, impaCode: 1, action: 1 });
// "Which descriptions confirm this SKU?" — useful for ops/debug
inventoryMatchFeedbackSchema.index({ inventoryItemId: 1 });

// Same (rfqDescription, inventoryItemId, action) tuple should upsert in place
inventoryMatchFeedbackSchema.index(
  { ownerId: 1, rfqDescription: 1, inventoryItemId: 1, action: 1 },
  { unique: true }
);

export type InventoryMatchFeedbackDocument = InferSchemaType<
  typeof inventoryMatchFeedbackSchema
>;

export const InventoryMatchFeedback =
  mongoose.models.InventoryMatchFeedback ||
  mongoose.model("InventoryMatchFeedback", inventoryMatchFeedbackSchema);
