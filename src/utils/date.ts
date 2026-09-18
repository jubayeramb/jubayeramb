// Dates are formatted with an explicit locale and UTC time zone. Using
// "default" made the output depend on whichever machine ran the build,
// and local time zones could shift a date-only value by a day.
const LOCALE = "en-US";

/**
 * Returns the month and year in a formatted string.
 * @param date - The date string in the format of "YYYY-MM" or "YYYY-MM-DD".
 * @returns A string in the format of "Month Year", e.g. "January 2022".
 */
export const getMonthYear = (date: string) => {
  if (!date) return "";
  const [year, month] = date.split("-");
  const monthName = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString(
    LOCALE,
    { month: "long", timeZone: "UTC" },
  );
  return `${monthName} ${year}`;
};

/**
 * Returns the full date as "Mon D, YYYY".
 * @param date - "yyyy-mm-dd" or "yyyy-mm-ddThh:mm:ss.sssZ".
 */
export const getFullDate = (date: string | Date) => {
  if (!date) return "";
  const iso = typeof date === "string" ? date : date.toISOString();
  const [year, month, day] = iso.split("T")[0].split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** "Sep 2026": used for coarse "last updated" labels. */
export const getShortMonthYear = (date: string | Date) =>
  new Date(date).toLocaleDateString(LOCALE, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** "2026-09-19": the date part of an ISO string, for <time datetime>. */
export const isoDay = (date: string | Date) =>
  (typeof date === "string" ? new Date(date) : date).toISOString().split("T")[0];
