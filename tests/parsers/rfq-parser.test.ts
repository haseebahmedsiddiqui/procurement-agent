import { describe, it, expect } from "vitest";
import {
  parseQuantity,
  detectColumns,
  detectFormat,
  MAX_ITEMS,
} from "@/lib/parsers/rfq-parser";

describe("parseQuantity", () => {
  it("parses plain integers", () => {
    expect(parseQuantity("10")).toEqual({ qty: 10, wasZero: false });
    expect(parseQuantity("1")).toEqual({ qty: 1, wasZero: false });
    expect(parseQuantity("999")).toEqual({ qty: 999, wasZero: false });
  });

  it("rounds decimals to nearest integer", () => {
    expect(parseQuantity("2.7")).toEqual({ qty: 3, wasZero: false });
    expect(parseQuantity("2.3")).toEqual({ qty: 2, wasZero: false });
    expect(parseQuantity("0.9")).toEqual({ qty: 1, wasZero: false });
  });

  it("treats European comma decimal as dot", () => {
    expect(parseQuantity("5,5")).toEqual({ qty: 6, wasZero: false });
  });

  it("strips non-numeric characters (units etc.)", () => {
    expect(parseQuantity("10 pcs")).toEqual({ qty: 10, wasZero: false });
    expect(parseQuantity("qty: 5")).toEqual({ qty: 5, wasZero: false });
  });

  it("returns qty=1 wasZero=true for zero", () => {
    expect(parseQuantity("0")).toEqual({ qty: 1, wasZero: true });
  });

  it("returns qty=1 wasZero=true for negative numbers", () => {
    expect(parseQuantity("-5")).toEqual({ qty: 1, wasZero: true });
  });

  it("returns qty=1 wasZero=false for non-numeric input", () => {
    expect(parseQuantity("abc")).toEqual({ qty: 1, wasZero: false });
    expect(parseQuantity("")).toEqual({ qty: 1, wasZero: false });
    expect(parseQuantity("N/A")).toEqual({ qty: 1, wasZero: false });
  });

  it("ensures minimum qty of 1 even for fractional < 0.5", () => {
    // 0.4 rounds to 0, but Math.max(1, ...) ensures 1
    expect(parseQuantity("0.4")).toEqual({ qty: 1, wasZero: false });
  });
});

describe("detectColumns", () => {
  it("detects standard maritime RFQ headers", () => {
    const headers = ["S.No", "IMPA Code", "Description", "Qty", "Unit", "Remarks"];
    const mapping = detectColumns(headers);
    expect(mapping.lineNumber).toBe(0);
    expect(mapping.impaCode).toBe(1);
    expect(mapping.description).toBe(2);
    expect(mapping.quantity).toBe(3);
    expect(mapping.unit).toBe(4);
    expect(mapping.notes).toBe(5);
  });

  it("detects alternative header names", () => {
    const headers = ["#", "Item Name", "Quantity", "UOM", "Note"];
    const mapping = detectColumns(headers);
    expect(mapping.lineNumber).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.quantity).toBe(2);
    expect(mapping.unit).toBe(3);
    expect(mapping.notes).toBe(4);
  });

  it("is case-insensitive", () => {
    const headers = ["DESCRIPTION", "QTY", "UNIT"];
    const mapping = detectColumns(headers);
    expect(mapping.description).toBe(0);
    expect(mapping.quantity).toBe(1);
    expect(mapping.unit).toBe(2);
  });

  it("leaves unmatched columns as null", () => {
    const headers = ["Product", "Amount"];
    const mapping = detectColumns(headers);
    expect(mapping.description).toBe(0); // matches "product"
    expect(mapping.quantity).toBe(1);    // matches "amount"
    expect(mapping.impaCode).toBeNull();
    expect(mapping.unit).toBeNull();
    expect(mapping.notes).toBeNull();
    expect(mapping.lineNumber).toBeNull();
  });

  it("returns all nulls for completely unknown headers", () => {
    const headers = ["Foo", "Bar", "Baz"];
    const mapping = detectColumns(headers);
    expect(mapping.description).toBeNull();
    expect(mapping.quantity).toBeNull();
  });

  it("handles empty strings in headers", () => {
    const headers = ["", "Description", "", "Qty"];
    const mapping = detectColumns(headers);
    expect(mapping.description).toBe(1);
    expect(mapping.quantity).toBe(3);
  });

  it("matches catalog/sku-based headers", () => {
    const headers = ["Cat No", "Specification", "Required Qty", "Pack"];
    const mapping = detectColumns(headers);
    expect(mapping.impaCode).toBe(0);  // "Cat No" → impaCode
    expect(mapping.description).toBe(1); // "Specification"
    expect(mapping.quantity).toBe(2);   // "Required Qty"
    expect(mapping.unit).toBe(3);       // "Pack"
  });

  it("handles Oleander multi-dept format (IMPA SECTION vs IMPA NO)", () => {
    // Real header: POS, REF NO, IMPA SECTION, IMPA NO, DESCRIPTION, UNIT, QTY x6, PRICE, TOTAL, COMMENTS...
    const headers = [
      "POS", "REF NO", "IMPA SECTION", "IMPA NO", "DESCRIPTION", "UNIT",
      "QTY", "QTY", "QTY", "QTY", "QTY", "QTY",
      "PRICE USD", "TOTAL USD", "COMMENTS FROM SUPPLIER",
    ];
    const mapping = detectColumns(headers);
    expect(mapping.lineNumber).toBe(0);  // POS
    expect(mapping.impaCode).toBe(3);    // IMPA NO (not IMPA SECTION)
    expect(mapping.description).toBe(4); // DESCRIPTION
    expect(mapping.unit).toBe(5);        // UNIT
    expect(mapping.quantity).toBe(11);   // Last QTY column (TOTAL)
    expect(mapping.notes).toBe(14);      // COMMENTS FROM SUPPLIER
  });

  it("handles headers with embedded newlines", () => {
    const headers = ["IMPA\nNO", "DESCRIPTION", "QTY"];
    const mapping = detectColumns(headers);
    expect(mapping.impaCode).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.quantity).toBe(2);
  });
});

describe("detectFormat", () => {
  it("detects Isolde Maritime format", () => {
    expect(detectFormat(["S.No", "IMPA Code", "Particulars", "Qty", "Unit"]))
      .toBe("Isolde Maritime");
  });

  it("detects generic IMPA format", () => {
    expect(detectFormat(["IMPA", "Description", "Qty"]))
      .toBe("Maritime (IMPA)");
  });

  it("detects catalog-based format", () => {
    expect(detectFormat(["Cat No", "Description", "Qty"]))
      .toBe("Catalog-based");
  });

  it("detects SKU-based format", () => {
    expect(detectFormat(["SKU", "Item Number", "Description", "Qty"]))
      .toBe("SKU-based");
  });

  it("returns Generic RFQ for unrecognized headers", () => {
    expect(detectFormat(["Product", "Amount", "Notes"]))
      .toBe("Generic RFQ");
  });
});

describe("MAX_ITEMS", () => {
  it("is set to 2000", () => {
    expect(MAX_ITEMS).toBe(2000);
  });
});
