/** Varied violet/blue hues for course-card thumbnail gradients. */
const COURSE_HUES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Deterministic accent hue for a course, cycled by its position in a list. */
export function courseHue(index: number): string {
  return COURSE_HUES[index % COURSE_HUES.length];
}

/** Gradient string for a course thumbnail banner, cycled by list position. */
export function courseGradient(index: number): string {
  const hue = courseHue(index);
  return `linear-gradient(120deg, ${hue}, color-mix(in oklab, ${hue} 50%, white))`;
}
