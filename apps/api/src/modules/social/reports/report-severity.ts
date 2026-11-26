import {
  isPaymentReportCategory,
  type ReportCategory,
  type ReportTargetType,
  type Severity,
} from '@touchgrass/shared';

/** Severity routing (F-SAF-05): safety-of-life and minors first, then abuse, then fraud, then noise. */
export const CATEGORY_SEVERITY: Record<ReportCategory, Severity> = {
  underage: 'critical',
  violence: 'critical',
  unsafe_event: 'high',
  harassment: 'high',
  hate_speech: 'high',
  nudity: 'high',
  scam: 'medium',
  // Money asked outside TouchGrass (D-228): fraud-level, and confirmed ones are strikes against the host.
  asked_to_pay: 'medium',
  asked_to_pay_outside: 'medium',
  impersonation: 'medium',
  spam: 'low',
  other: 'low',
};

const ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

export function maxSeverity(a: Severity, b: Severity): Severity {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Many independent reports on one target escalate it one level at 3 and two levels at 10 reporters. */
export function escalate(base: Severity, distinctReporters: number): Severity {
  const bump = distinctReporters >= 10 ? 2 : distinctReporters >= 3 ? 1 : 0;
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(base) + bump)] ?? base;
}

/** Money asks are about plans, people and what they say, not photos or stories (D-228). */
export function categoryFitsTarget(
  targetType: ReportTargetType,
  category: ReportCategory,
): boolean {
  if (!isPaymentReportCategory(category)) return true;
  return targetType !== 'story' && targetType !== 'lore_media';
}
