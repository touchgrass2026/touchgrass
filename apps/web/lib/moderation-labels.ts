import { HeldReason, ReportCategory, resources } from '@touchgrass/shared';

/** The report reason in words ("Asked me to pay", D-228), or '' for automatic flags. */
export function categoryLabel(details: Record<string, unknown>): string {
  const category = ReportCategory.safeParse(details.lastCategory);
  return category.success ? resources.en.report.categories[category.data] : '';
}

/** Why automatic screening held it: language, payment outside TouchGrass, phone number (D-228). */
export function holdReasonLabels(details: Record<string, unknown>): string[] {
  const reasons = Array.isArray(details.reasons) ? details.reasons : [];
  return reasons.flatMap((r) => {
    const parsed = HeldReason.safeParse(r);
    return parsed.success ? [resources.en.admin.holdReasons[parsed.data]] : [];
  });
}
