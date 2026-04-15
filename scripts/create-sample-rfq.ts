import ExcelJS from "exceljs";
import path from "path";

async function createSampleRFQs() {
  // ===== STATIONERY RFQ (Isolde Maritime format) =====
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet("RFQ Items");

  // Header rows (maritime format often has a title row)
  ws1.addRow(["ISOLDE MARITIME LTD — REQUISITION FOR QUOTATION"]);
  ws1.addRow(["Vessel: MV Atlantic Star", "", "Date: 2026-04-01"]);
  ws1.addRow([]); // blank
  ws1.addRow([
    "S.No", "IMPA Code", "Description / Particulars", "Qty", "UoM", "Remarks",
  ]);

  const stationeryItems = [
    [1, "471143", "FOLD BACK CLIP 32MM", 10, "BOX", "Medium size"],
    [2, "471101", "BALL POINT PEN BLUE", 50, "PC", ""],
    [3, "471102", "BALL POINT PEN BLACK", 50, "PC", ""],
    [4, "471105", "BALL POINT PEN RED", 20, "PC", ""],
    [5, "471201", "PENCIL HB", 24, "PC", ""],
    [6, "471301", "ERASER WHITE LARGE", 10, "PC", ""],
    [7, "471401", "RULER PLASTIC 30CM", 5, "PC", "Transparent"],
    [8, "471501", "SCISSORS OFFICE 8 INCH", 3, "PC", "Stainless steel"],
    [9, "471601", "STAPLER MEDIUM DESKTOP", 2, "PC", "With staples"],
    [10, "471701", "TAPE ADHESIVE CLEAR 24MM", 12, "ROLL", ""],
    [11, "471801", "CORRECTION FLUID WHITE", 6, "PC", "Quick dry"],
    [12, "471901", "HIGHLIGHTER YELLOW", 12, "PC", ""],
    [13, "472001", "MARKER PERMANENT BLACK", 12, "PC", "Fine tip"],
    [14, "472101", "NOTEBOOK A4 RULED 200PG", 10, "PC", "Hard cover"],
    [15, "472201", "ENVELOPE BROWN A4", 100, "PC", ""],
    [16, "472301", "FILE FOLDER CLEAR A4", 20, "PC", ""],
    [17, "472401", "PAPER CLIP SMALL 28MM", 10, "BOX", "100pc per box"],
    [18, "472501", "GLUE STICK 21G", 6, "PC", ""],
    [19, "472601", "STICKY NOTES 76X76MM", 12, "PAD", "Yellow"],
    [20, "472701", "CALCULATOR DESKTOP 12 DIGIT", 2, "PC", "Solar powered"],
    [21, "472801", "WHITEBOARD MARKER ASSORTED", 12, "SET", "4 colors"],
    [22, "472901", "PAPER A4 80GSM", 10, "REAM", "White"],
    [23, "473001", "BINDER RING 2-HOLE A4", 5, "PC", ""],
    [24, "473101", "TONER CARTRIDGE HP 26A", 2, "PC", "Black"],
    [25, "473201", "LABEL STICKER A4 SHEET", 5, "PACK", "Assorted sizes"],
    [26, "473301", "STAMP PAD INK BLUE", 2, "PC", ""],
  ];

  stationeryItems.forEach((item) => ws1.addRow(item));

  await wb1.xlsx.writeFile(
    path.join(process.cwd(), "exports", "sample-rfq-stationery.xlsx")
  );
  console.log("Created: sample-rfq-stationery.xlsx (26 items, Isolde Maritime format)");

  // ===== DECK/ENGINE RFQ =====
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("Deck Stores");

  ws2.addRow(["Item No", "IMPA Code", "Description", "Quantity", "Unit", "Notes"]);

  const deckItems = [
    [1, "390101", "WIRE ROPE 12MM GALVANIZED", 200, "MTR", "6x19 construction"],
    [2, "390201", "SHACKLE BOW TYPE 1 INCH", 10, "PC", "Galvanized"],
    [3, "390301", "PAINT ANTI-FOULING RED 5L", 8, "CAN", "Self-polishing"],
    [4, "390401", "MOORING ROPE POLYPROPYLENE 80MM", 100, "MTR", ""],
    [5, "390501", "SAFETY HELMET WHITE", 10, "PC", "EN 397 certified"],
    [6, "370101", "GASKET SET ENGINE MAIN", 1, "SET", "For MAN B&W 6S50ME"],
    [7, "370201", "FILTER OIL PURIFIER", 20, "PC", "Alfa Laval compatible"],
    [8, "370301", "BEARING BALL 6205-2RS", 10, "PC", "SKF or equivalent"],
    [9, "370401", "VALVE GLOBE DN50 PN16", 4, "PC", "Bronze body"],
    [10, "370501", "PUMP IMPELLER CENTRIFUGAL", 2, "PC", "Sea water service"],
  ];

  deckItems.forEach((item) => ws2.addRow(item));

  await wb2.xlsx.writeFile(
    path.join(process.cwd(), "exports", "sample-rfq-deck-engine.xlsx")
  );
  console.log("Created: sample-rfq-deck-engine.xlsx (10 items)");

  // ===== GALLEY/KITCHEN RFQ =====
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet("Galley Items");

  ws3.addRow(["No.", "Description", "Qty", "Unit", "Remarks"]);

  const galleyItems = [
    [1, "FRYING PAN NON-STICK 28CM", 4, "PC", "Heavy duty"],
    [2, "COOKING POT STAINLESS 20L", 2, "PC", "With lid"],
    [3, "CUTTING BOARD PLASTIC WHITE", 4, "PC", "HACCP approved"],
    [4, "CHEF KNIFE 10 INCH", 3, "PC", "Stainless steel"],
    [5, "ALUMINIUM FOIL 30CM WIDE", 12, "ROLL", "Heavy duty"],
    [6, "DISHWASHING DETERGENT 5L", 6, "PC", "Concentrated"],
    [7, "DISPOSABLE GLOVES NITRILE L", 10, "BOX", "100pc per box"],
    [8, "FOOD STORAGE CONTAINER 5L", 10, "PC", "Clear with lid"],
  ];

  galleyItems.forEach((item) => ws3.addRow(item));

  await wb3.xlsx.writeFile(
    path.join(process.cwd(), "exports", "sample-rfq-galley.xlsx")
  );
  console.log("Created: sample-rfq-galley.xlsx (8 items)");

  // ===== MIXED RFQ =====
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet("Mixed Requisition");

  ws4.addRow(["Line", "IMPA", "Item Description", "Required Qty", "U/M", "Note"]);

  const mixedItems = [
    [1, "471143", "FOLD BACK CLIP 32MM", 10, "BOX", "Stationery"],
    [2, "471101", "BALL POINT PEN BLUE", 50, "PC", "Stationery"],
    [3, "472901", "PAPER A4 80GSM", 10, "REAM", "Stationery"],
    [4, "", "FRYING PAN NON-STICK 28CM", 4, "PC", "Galley"],
    [5, "", "COOKING POT STAINLESS 20L", 2, "PC", "Galley"],
    [6, "390101", "WIRE ROPE 12MM GALVANIZED", 200, "MTR", "Deck"],
    [7, "390301", "PAINT ANTI-FOULING RED 5L", 8, "CAN", "Deck"],
  ];

  mixedItems.forEach((item) => ws4.addRow(item));

  await wb4.xlsx.writeFile(
    path.join(process.cwd(), "exports", "sample-rfq-mixed.xlsx")
  );
  console.log("Created: sample-rfq-mixed.xlsx (7 items, mixed categories)");
}

createSampleRFQs().catch(console.error);
