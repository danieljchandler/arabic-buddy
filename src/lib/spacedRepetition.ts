/**
 * SM-2 Spaced Repetition Algorithm
 * Based on the SuperMemo 2 algorithm used by Anki
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewResult {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: Date;
}

// Quality ratings mapped to SM-2 quality values (0-5)
const QUALITY_MAP: Record<Rating, number> = {
  again: 0, // Complete failure
  hard: 2,  // Remembered with difficulty
  good: 3,  // Correct with some hesitation
  easy: 5,  // Perfect recall
};

// Minimum ease factor to prevent intervals from becoming too short
const MIN_EASE_FACTOR = 1.3;

// Base intervals for new cards (in days)
const INTERVALS = {
  again: 1 / 1440, // 1 minute (for learning)
  hard: 1 / 144,   // 10 minutes
  firstGood: 1,    // 1 day for first successful review
  firstEasy: 4,    // 4 days for easy on first review
};

export function calculateNextReview(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  repetitions: number
): ReviewResult {
  const quality = QUALITY_MAP[rating];
  
  let newEaseFactor = currentEaseFactor;
  let newInterval = currentInterval;
  let newRepetitions = repetitions;

  if (quality < 3) {
    // Failed review - reset repetitions
    newRepetitions = 0;
    
    if (rating === 'again') {
      newInterval = INTERVALS.again;
    } else {
      newInterval = INTERVALS.hard;
    }
    
    // Decrease ease factor
    newEaseFactor = Math.max(MIN_EASE_FACTOR, currentEaseFactor - 0.2);
  } else {
    // Successful review
    newRepetitions = repetitions + 1;

    if (repetitions === 0) {
      // First successful review
      newInterval = rating === 'easy' ? INTERVALS.firstEasy : INTERVALS.firstGood;
    } else if (repetitions === 1) {
      // Second successful review
      newInterval = rating === 'easy' ? 4 : 1;
    } else {
      // Subsequent reviews - apply ease factor
      newInterval = currentInterval * newEaseFactor;
      
      // Apply rating modifiers
      if (rating === 'hard') {
        newInterval *= 0.8;
        newEaseFactor = Math.max(MIN_EASE_FACTOR, newEaseFactor - 0.15);
      } else if (rating === 'easy') {
        newInterval *= 1.3;
        newEaseFactor += 0.15;
      }
    }
    
    // Update ease factor based on quality
    if (rating === 'good') {
      // Small adjustment for "good" ratings
      newEaseFactor = Math.max(MIN_EASE_FACTOR, newEaseFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    }
  }

  // Round interval to reasonable values
  if (newInterval < 1) {
    // Keep minute-level precision for short intervals
  } else {
    newInterval = Math.round(newInterval);
  }

  // Calculate next review date
  const nextReviewAt = new Date();
  nextReviewAt.setTime(nextReviewAt.getTime() + newInterval * 24 * 60 * 60 * 1000);

  return {
    easeFactor: Math.round(newEaseFactor * 100) / 100,
    intervalDays: newInterval,
    repetitions: newRepetitions,
    nextReviewAt,
  };
}

export function getIntervalDisplay(intervalDays: number): string {
  if (intervalDays < 1 / 60) {
    return '< 1m';
  } else if (intervalDays < 1 / 24) {
    const minutes = Math.round(intervalDays * 24 * 60);
    return `${minutes}m`;
  } else if (intervalDays < 1) {
    const hours = Math.round(intervalDays * 24);
    return `${hours}h`;
  } else if (intervalDays < 30) {
    const days = Math.round(intervalDays);
    return `${days}d`;
  } else if (intervalDays < 365) {
    const months = Math.round(intervalDays / 30);
    return `${months}mo`;
  } else {
    const years = Math.round(intervalDays / 365 * 10) / 10;
    return `${years}y`;
  }
}

export function estimateNextInterval(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  repetitions: number
): string {
  const result = calculateNextReview(rating, currentEaseFactor, currentInterval, repetitions);
  return getIntervalDisplay(result.intervalDays);
}
