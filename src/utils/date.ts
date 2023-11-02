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
