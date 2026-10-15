/**
 * 「2 時間前」「昨日」のような相対表示。再開カードの「最終更新」に使う。
 * 日をまたぐ判定は、端末のローカル日付で行う。
 */
export function relativeTimeJa(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (Number.isNaN(then.getTime())) return "";
  if (diff < 60_000) return "たった今";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 時間前`;
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 1) return "昨日";
  if (days < 7) return `${days} 日前`;
  if (days < 35) return `${Math.floor(days / 7)} 週間前`;
  return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
}
