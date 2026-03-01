import type { GapWarning, PublishCheckItem, Segment } from '@/types/transcript';

/**
 * Analyse an ordered array of segments for timing issues.
 *
 * Checks:
 * - Gap > 2 s between consecutive segments → amber warning
 * - Overlap (seg.end > next.start) → red error (blocks export)
 * - Duration < 0.5 s → warning (too short)
 * - Duration > 7 s → warning (too long)
 */
export function analyseGaps(segments: Segment[]): GapWarning[] {
  const warnings: GapWarning[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const duration = seg.end - seg.start;

    if (duration < 0.5) {
      warnings.push({
        type: 'too-short',
        severity: 'warning',
        message: `Segment ${i + 1} is too short (${duration.toFixed(2)}s)`,
        segmentIndex: i,
      });
    }

    if (duration > 7) {
      warnings.push({
        type: 'too-long',
        severity: 'warning',
        message: `Segment ${i + 1} is too long (${duration.toFixed(2)}s)`,
        segmentIndex: i,
      });
    }

    if (i < segments.length - 1) {
      const next = segments[i + 1];
      const gap = next.start - seg.end;

      if (gap < 0) {
        warnings.push({
          type: 'overlap',
          severity: 'error',
          message: `Segments ${i + 1} and ${i + 2} overlap by ${Math.abs(gap).toFixed(2)}s`,
          segmentIndex: i,
          segmentIndexB: i + 1,
        });
      } else if (gap > 2) {
        warnings.push({
          type: 'gap',
          severity: 'warning',
          message: `Gap of ${gap.toFixed(2)}s between segments ${i + 1} and ${i + 2}`,
          segmentIndex: i,
          segmentIndexB: i + 1,
        });
      }
    }
  }

  return warnings;
}

/**
 * Run the publish checklist against the current segments.
 *
 * Rules:
 * - No overlapping segments
 * - No segment longer than 8 seconds
 * - All segments have a translation
 * - Average confidence > 0.70
 * - No unreviewed red-confidence (< 0.65) segments
 */
export function runPublishChecklist(segments: Segment[]): PublishCheckItem[] {
  const warnings = analyseGaps(segments);
  const hasOverlap = warnings.some(w => w.type === 'overlap');
  const hasLongSegment = segments.some(s => s.end - s.start > 8);
  const allTranslated = segments.every(s => s.translation && s.translation.trim().length > 0);
  const avgConfidence =
    segments.length > 0
      ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
      : 0;
  const hasRedConfidence = segments.some(s => s.confidence < 0.65);

  return [
    { label: 'No overlapping segments', passed: !hasOverlap },
    { label: 'No segment > 8 seconds', passed: !hasLongSegment },
    { label: 'All segments have a translation', passed: allTranslated },
    { label: 'Average confidence > 0.70', passed: avgConfidence > 0.7 },
    { label: 'No unreviewed red-confidence segments', passed: !hasRedConfidence },
  ];
}
