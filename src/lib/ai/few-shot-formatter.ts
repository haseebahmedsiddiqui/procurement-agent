export interface FewShot {
  rfqDescription: string;
  productName: string;
  action: "confirmed" | "rejected" | "corrected";
}

export function formatFewShots(shots: FewShot[]): string {
  if (shots.length === 0) return "";
  const lines = shots.map((s) => {
    const verdict =
      s.action === "confirmed" ? "ACCEPTED" : "REJECTED";
    return `- For RFQ "${s.rfqDescription}" → "${s.productName}" was ${verdict}`;
  });
  return `\nPAST DECISIONS BY OPERATORS (use these as your guide):\n${lines.join("\n")}\n`;
}
