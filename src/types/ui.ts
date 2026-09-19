/** One row of src/components/ui/Timeline.astro. */
export type TimelineItem = {
  label: string;
  title: string;
  /** Company / institution line; `href` links it. */
  org?: string;
  href?: string;
  /** Detail after the org, e.g. exact dates. */
  detail?: string;
  description?: string;
  tags?: string[];
};
