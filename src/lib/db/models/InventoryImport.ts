import mongoose, { Schema, type InferSchemaType } from "mongoose";

const importedFileSchema = new Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["item-listing", "sales-report", "unknown"],
      required: true,
    },
    sha256: { type: String },
    rowCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const importErrorSchema = new Schema(
  {
    itemCode: { type: String },
    line: { type: Number },
    reason: { type: String, required: true },
  },
  { _id: false }
);

const importResultSchema = new Schema(
  {
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
    masked: { type: Number, default: 0 },
    // Renamed from "errors" because Mongoose reserves that path.
    parseErrors: [importErrorSchema],
  },
  { _id: false }
);

const inventoryImportSchema = new Schema(
  {
    ownerId: { type: String, default: null, index: true },
    importedAt: { type: Date, default: Date.now, index: true },
    importedBy: { type: String, default: null },
    files: [importedFileSchema],
    result: { type: importResultSchema, default: () => ({}) },

    // From the "Date:" header on the PDF (the ERP's "as of" date)
    reportDate: { type: Date, default: null },
  },
  { timestamps: true }
);

export type InventoryImportDocument = InferSchemaType<typeof inventoryImportSchema>;

export const InventoryImport =
  mongoose.models.InventoryImport ||
  mongoose.model("InventoryImport", inventoryImportSchema);
