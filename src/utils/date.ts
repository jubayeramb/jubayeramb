/**
 * Returns the month and year in a formatted string.
 * @param date - The date string in the format of "YYYY-MM".
 * @returns A string in the format of "Month Year", e.g. "January 2022".
 */
export const getMonthYear = (date: string) => {
  if (!date) return "";
  const [year, month] = date.split("-");
  const monthName = new Date(`${year}-${month}-01`).toLocaleString("default", {
    month: "long",
  });
  return `${monthName} ${year}`;
};

/**
 * Returns the full date in the format of "day monthName year".
 * @param date - The date string in the format of "yyyy-mm-dd" or "yyyy-mm-ddThh:mm:ss.sssZ".
 * @returns The full date string in the format of "month day, year".
 */
export const getFullDate = (date: string) => {
  if (!date) return "";
  const [year, month, day] = date.split("T")[0].split("-");
  const monthName = new Date(`${year}-${month}-${day}`).toLocaleString(
    "default",
    {
      month: "short",
    }
  );
  return `${monthName} ${parseInt(day)}, ${year}`;
};
