export const historyPeriods = ["today", "yesterday", "history"] as const;
export type HistoryPeriod = (typeof historyPeriods)[number];
export const historyPeriodLabels = { today: "今天", yesterday: "昨天", history: "历史" };
const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Use calendar dates rather than elapsed 24-hour windows. Sessions follow last activity.
export function historyPeriod(updatedAt: number, now = Date.now()): HistoryPeriod {
  const today = calendar.format(now);
  const [year, month, day] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const date = calendar.format(updatedAt);
  return date === today ? "today" : date === yesterday ? "yesterday" : "history";
}

export function historyPrograms(programs: string[]): string[] {
  const order = ["codex", "grok", "kiro", "claude", "gemini", "opencode"];
  return [...new Set(programs)].sort((a, b) => {
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}
