export interface FewShot {
  rfqDescription: string;
  productName: string;
  action: "confirmed" | "rejected" | "corrected";
  reason?: string;
}

export function formatFewShots(shots: FewShot[]): string {
  if (shots.length === 0) return "";
  const lines = shots.map((s) => {
    const verdict = s.action === "confirmed" ? "ACCEPTED" : "REJECTED";
    const suffix = s.reason?.trim() ? ` (reason: ${s.reason.trim()})` : "";
    return `- For RFQ "${s.rfqDescription}" → "${s.productName}" was ${verdict}${suffix}`;
  });
  return `\nPAST DECISIONS BY OPERATORS (use these as your guide):\n${lines.join("\n")}\n`;
}
