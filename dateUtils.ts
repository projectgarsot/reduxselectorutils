// src/utils/dateUtils.ts
import { format as formatDateFns } from 'date-fns';
import type { Draft } from 'immer';
import { createSelector } from '@reduxjs/toolkit';

/**
 * Represents a Unix timestamp (milliseconds since epoch).
 * Using branded type pattern for compile-time type safety.
 */
export type Timestamp = number & { readonly __brand: 'Timestamp' };

/**
 * Type predicate for TypeScript type narrowing with Timestamp
 */
export function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'number' && 
         Number.isFinite(value) && 
         !Number.isNaN(value);
}

/**
 * Time unit constants in seconds
 */
export const TIME_UNITS = {
  SECOND: 1,
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  MONTH: 2592000, // 30 days
  YEAR: 31536000, // 365 days
} as const;

/**
 * Date formatting options
 */
export const DATE_OPTIONS = {
  FULL: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  } as const,
  DATETIME: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  } as const,
} as const;

/**
 * Type-safe error handling result type using discriminated union
 */
type Result<T> = 
  | { success: true; value: T }
  | { success: false; error: Error };

/**
 * Higher-order function for consistent error handling
 */
function withErrorHandling<T>(operation: () => T, fallback: T): Result<T> {
  try {
    const result = operation();
    return { success: true, value: result };
  } catch (error) {
    console.error('Date operation failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error : new Error(String(error)) 
    };
  }
}

/**
 * Helper to convert a number into the branded Timestamp type
 */
export function toTimestamp(value: number): Timestamp {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  return value as Timestamp;
}

/**
 * Helper to convert a Timestamp into a Draft<Timestamp> for Immer compatibility
 */
export function asDraftTimestamp(timestamp: Timestamp): Draft<Timestamp> {
  return timestamp as unknown as Draft<Timestamp>;
}

/**
 * Format relative time (e.g., "5 minutes ago")
 */
function formatRelativeTime(diffInSeconds: number): string {
  // Using readonly array for units
  const units: ReadonlyArray<{ readonly value: number; readonly label: string }> = [
    { value: TIME_UNITS.YEAR, label: 'year' },
    { value: TIME_UNITS.MONTH, label: 'month' },
    { value: TIME_UNITS.DAY, label: 'day' },
    { value: TIME_UNITS.HOUR, label: 'hour' },
    { value: TIME_UNITS.MINUTE, label: 'minute' },
    { value: TIME_UNITS.SECOND, label: 'second' },
  ];

  for (const { value, label } of units) {
    if (diffInSeconds >= value) {
      const count = Math.floor(diffInSeconds / value);
      return `${count} ${label}${count !== 1 ? 's' : ''} ago`;
    }
  }

  return 'just now';
}

/**
 * Validate that a timestamp represents a valid date
 */
function validateTimestamp(timestamp: Timestamp): boolean {
  const date = new Date(timestamp);
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/**
 * Date utilities optimized for Redux/TypeScript applications
 */
export const dateUtils = {
  /**
   * Create a new timestamp representing the current time
   */
  create: (): Timestamp => toTimestamp(Date.now()),

  /**
   * Format a timestamp as a localized date string
   */
  format: (timestamp: Timestamp): string => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(timestamp)) {
          throw new Error('Invalid timestamp');
        }
        return new Date(timestamp).toLocaleDateString(undefined, DATE_OPTIONS.FULL);
      },
      'Invalid Date'
    );
    
    return result.success ? result.value : result.error.message;
  },

  /**
   * Format a timestamp as a localized date and time string
   */
  formatDateTime: (timestamp: Timestamp): string => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(timestamp)) {
          throw new Error('Invalid timestamp');
        }
        return new Date(timestamp).toLocaleString(undefined, DATE_OPTIONS.DATETIME);
      },
      'Invalid DateTime'
    );
    
    return result.success ? result.value : result.error.message;
  },

  /**
   * Convert a timestamp to ISO string format
   */
  toISOString: (timestamp: Timestamp): string => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(timestamp)) {
          throw new Error('Invalid timestamp');
        }
        return new Date(timestamp).toISOString();
      },
      'Invalid Date'
    );
    
    return result.success ? result.value : result.error.message;
  },

  /**
   * Calculate and format the relative time from now
   */
  relativeTime: (timestamp: Timestamp): string => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(timestamp)) {
          throw new Error('Invalid timestamp');
        }
        const now = dateUtils.create();
        const diffInSeconds = Math.floor((now - timestamp) / 1000);
        return formatRelativeTime(diffInSeconds);
      },
      'Invalid Time'
    );
    
    return result.success ? result.value : result.error.message;
  },

  /**
   * Format a timestamp using a custom date-fns format string
   */
  formatCustom: (timestamp: Timestamp, dateFormat: string): string => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(timestamp)) {
          throw new Error('Invalid timestamp');
        }
        if (!dateFormat) {
          throw new Error('Date format is required');
        }
        return formatDateFns(new Date(timestamp), dateFormat);
      },
      'Invalid Format'
    );
    
    return result.success ? result.value : result.error.message;
  },

  /**
   * Check if a timestamp is valid
   */
  isValid: (timestamp: Timestamp): boolean => {
    return validateTimestamp(timestamp);
  },

  /**
   * Compare two timestamps and return their difference
   */
  compare: (date1: Timestamp, date2: Timestamp): number => {
    const result = withErrorHandling(
      () => {
        if (!validateTimestamp(date1) || !validateTimestamp(date2)) {
          throw new Error('Invalid timestamp(s)');
        }
        return date1 - date2;
      },
      0
    );
    
    return result.success ? result.value : 0;
  },

  /**
   * Calculate the difference between two timestamps in days
   */
  diffInDays: (date1: Timestamp, date2: Timestamp): number => {
    const diffInMs = Math.abs(date1 - date2);
    return Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  },

  /**
   * Convert a value to a Draft-compatible type for Immer
   */
  toImmerable<T>(value: T): Draft<T> {
    return value as unknown as Draft<T>;
  },

  /**
   * Create a Draft-compatible timestamp for Immer fields
   */
  createDraftTimestamp: (): Draft<Timestamp> => asDraftTimestamp(toTimestamp(Date.now())),
} as const;

/**
 * Memoized selector for formatting dates (example for Redux integration)
 * This demonstrates how to leverage createSelector with the dateUtils
 */
export const createDateFormatSelector = () => {
  return createSelector(
    [(state: unknown, timestamp: Timestamp) => timestamp],
    (timestamp) => dateUtils.format(timestamp)
  );
};

/**
 * Memoized selector for relative time formatting (example for Redux integration)
 */
export const createRelativeTimeSelector = () => {
  return createSelector(
    [(state: unknown, timestamp: Timestamp) => timestamp],
    (timestamp) => dateUtils.relativeTime(timestamp)
  );
};

export type DateUtils = typeof dateUtils;

// Named exports for utility functions
export const toImmerable = dateUtils.toImmerable;
export const createDraftTimestamp = dateUtils.createDraftTimestamp;

export default dateUtils;
