import { describe, it, expect } from "vitest";
import {
  detectReportType,
  parseSalesReport,
  parseItemListing,
} from "@/lib/inventory/pdf-parser";

describe("detectReportType", () => {
  it("recognizes ICR720 sales report", () => {
    const text = `Date: 05/03/26                   DELAWARE SHIP SUPPLY CO., INC.                        ICR720 Page: 1
                                               ITEM SALES REPORT`;
    expect(detectReportType(text)).toBe("sales-report");
  });

  it("recognizes ICR740 item listing", () => {
    const text = `Date: 05/02/26           DELAWARE SHIP SUPPLY CO., INC.                    ICR740 Page: 1
                                      Warehouse/Item Listing`;
    expect(detectReportType(text)).toBe("item-listing");
  });

  it("returns unknown for unrecognized text", () => {
    expect(detectReportType("hello world")).toBe("unknown");
  });
});

describe("parseSalesReport", () => {
  // Real sample from the customer's PDF (page 1).
  const SAMPLE = `Date: 05/03/26                   DELAWARE SHIP SUPPLY CO., INC.                        ICR720 Page: 1
User: SAF T0b                                                                          Time: 2:52 AM
                                               ITEM SALES REPORT

ITEM FIRST TO LAST

VENDOR ALL

                                                LAST                                   GROSS

ITEM                DESCRIPTION                 SALE         UNITS UM  SALES   COST    MARGIN G.M.%

===============================================================================================================================

Warehouse 01 CAMDEN WAREHOUSE

01GE40              ****************************** 09/09/15  .0 CS     .00     .00     .00    .0% MTD

                                                             .0 CS     .00     .00     .00    .0% YTD

                                                             .0 CS     .00     .00     .00    .0% PYR

03GE21              HERRING FILLET MUST. SAUCE 7OZ 04/20/26   6.0 EA    33.05   23.94   9.11  38.1% MTD
                                                              6.0 EA    33.05   23.94   9.11  38.1% YTD
                                                             37.0 EA   204.43  147.63  56.80  38.5% PYR

04GE01B         ******************************            .0 EA     .00       .00       .00       .0% MTD

                                                          .0 EA     .00       .00       .00       .0% YTD

                                                          .0 EA     .00       .00       .00       .0% PYR
`;

  const { rows, errors, reportDate } = parseSalesReport(SAMPLE);

  it("extracts the report date from the header", () => {
    expect(reportDate?.getFullYear()).toBe(2026);
    expect(reportDate?.getMonth()).toBe(4); // May
    expect(reportDate?.getDate()).toBe(3);
  });

  it("parses three items", () => {
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it("flags fully masked descriptions", () => {
    const masked1 = rows.find((r) => r.itemCode === "01GE40");
    expect(masked1?.isMasked).toBe(true);
    expect(masked1?.description).toBe("");

    const masked2 = rows.find((r) => r.itemCode === "04GE01B");
    expect(masked2?.isMasked).toBe(true);
  });

  it("preserves last sale date when present, leaves null when absent", () => {
    const masked1 = rows.find((r) => r.itemCode === "01GE40");
    expect(masked1?.lastSaleDate?.getFullYear()).toBe(2015);

    const masked2 = rows.find((r) => r.itemCode === "04GE01B");
    expect(masked2?.lastSaleDate).toBeNull();
  });

  it("captures real description, UM, and three periods of figures", () => {
    const sample = rows.find((r) => r.itemCode === "03GE21");
    expect(sample).toBeDefined();
    expect(sample!.description).toBe("HERRING FILLET MUST. SAUCE 7OZ");
    expect(sample!.unitOfMeasure).toBe("EA");
    expect(sample!.isMasked).toBe(false);
    expect(sample!.mtd.units).toBe(6);
    expect(sample!.mtd.salesUsd).toBeCloseTo(33.05);
    expect(sample!.mtd.costUsd).toBeCloseTo(23.94);
    expect(sample!.mtd.marginPct).toBeCloseTo(38.1);
    expect(sample!.pyr.units).toBe(37);
    expect(sample!.pyr.salesUsd).toBeCloseTo(204.43);
    expect(sample!.pyr.costUsd).toBeCloseTo(147.63);
  });
});

describe("parseItemListing", () => {
  const SAMPLE = `Date: 05/02/26           DELAWARE SHIP SUPPLY CO., INC.                    ICR740 Page: 1
User: SAF T0b                                                              Time: 7:39 AM
                                      Warehouse/Item Listing

Item from First to Last

Vendor ALL

Warehouse 01

Company Rank: Type=Percentage (A-80%, B-15%, C-4%, D-1%, E-0%)

                                            ST         Primary  ----Physical----- Ldgr

Item            Description                 UM RK U Location Created Last  Next Card

====================================================================================================

Warehouse 01 CAMDEN WAREHOUSE

01GE40          ****************************** CS E B                    01/19/06 01/17/26 04/17/26 Y
18CUMIN         GROUND CUMIN              LB A B                11/24/99 01/17/26 04/17/26 Y
174261          SNAKE WIRE PIPE CLEANER 6MM EA C B              04/09/01 01/17/26 04/17/26 Y
04GE07          HERRING FILLET PAPRIKA/PEPPER CS E B            204C 01/19/06 01/17/26 04/17/26 Y
`;

  const { rows } = parseItemListing(SAMPLE);

  it("parses every well-formed row", () => {
    expect(rows.length).toBe(4);
  });

  it("extracts rank, UM, and description correctly", () => {
    const cumin = rows.find((r) => r.itemCode === "18CUMIN");
    expect(cumin).toBeDefined();
    expect(cumin!.description).toBe("GROUND CUMIN");
    expect(cumin!.unitOfMeasure).toBe("LB");
    expect(cumin!.rank).toBe("A");
    expect(cumin!.isMasked).toBe(false);
    expect(cumin!.primaryLocation).toBeNull();
  });

  it("captures a shelf-location code when present", () => {
    const row = rows.find((r) => r.itemCode === "04GE07");
    expect(row?.primaryLocation).toBe("204C");
    expect(row?.rank).toBe("E");
    expect(row?.unitOfMeasure).toBe("CS");
  });

  it("flags masked descriptions", () => {
    const masked = rows.find((r) => r.itemCode === "01GE40");
    expect(masked?.isMasked).toBe(true);
    expect(masked?.description).toBe("");
    expect(masked?.rank).toBe("E");
    expect(masked?.unitOfMeasure).toBe("CS");
  });
});
