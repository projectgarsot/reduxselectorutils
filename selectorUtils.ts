import { createSelector } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/react';
import { BaseCommonState } from '../types/commonTypes';
import dateUtils from './dateUtils';

/**
 * Options for parameterized selectors
 */
export interface ParameterizedSelectorOptions {
  maxSize?: number;
  equalityCheck?: (a: any, b: any) => boolean;
  debugLabel?: string;
  trackPerformance?: boolean;
  logMisses?: boolean;
  logHits?: boolean;
  expireAfter?: number; // milliseconds
}

/**
 * Default options for parameterized selectors
 */
const DEFAULT_OPTIONS: ParameterizedSelectorOptions = {
  maxSize: 10,
  equalityCheck: (a, b) => a === b,
  trackPerformance: false,
  logMisses: false,
  logHits: false
};

export type ExtendedFactorySelector<State, Result, Params extends any[]> = ((state: State, ...params: Params) => Result) & {
  clearCache: () => void;
  getStats: () => {
    cacheSize: number;
    maxSize: number | undefined;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    totalExecutionTime: number;
    averageExecutionTime: number;
    entries: Array<{
      key: string;
      hits: number;
      misses: number;
      lastUsed: number;
      created: number;
      executionTime: number;
      age: number;
    }>;
  };
  invalidateCache: (predicate?: (params: Params) => boolean) => number | void;
  debugLabel?: string;
};

/**
 * Creates a factory for memoized selectors that accept parameters
 *
 * @template State - The state type (usually RootState)
 * @template Result - The return type of the selector
 * @template Params - The parameter types as a tuple
 * @param selector - The selector function that accepts state and parameters
 * @param options - Configuration options for caching behavior
 * @returns A memoized selector function that accepts the same parameters
 */
export function createParameterizedSelector<State, Result, Params extends any[]>(
  selector: (state: State, ...params: Params) => Result,
  options: ParameterizedSelectorOptions = {}
) {
  const {
    maxSize,
    equalityCheck,
    debugLabel,
    trackPerformance,
    logMisses,
    logHits,
    expireAfter
  } = { ...DEFAULT_OPTIONS, ...options };

  // Cache to store memoized selectors
  const selectorCache = new Map<string, {
    selector: ReturnType<typeof createSelector>;
    lastUsed: number;
    created: number;
    hits: number;
    misses: number;
    executionTime: number;
  }>();

  // LRU tracking
  const keyUsage: string[] = [];

  // Performance tracking
  let totalHits = 0;
  let totalMisses = 0;
  let totalExecutionTime = 0;

  const factorySelector = (state: State, ...params: Params): Result => {
    const cacheEntry = getOrCreateCacheEntry(state, params);
    return computeResult(state, cacheEntry);
  };

  const getOrCreateCacheEntry = (_state: State, params: Params) => {
    // Create a stable cache key from parameters
    const cacheKey = getCacheKeyForParams(params);

    // Track usage for LRU
    const keyIndex = keyUsage.indexOf(cacheKey);
    if (keyIndex > -1) {
      keyUsage.splice(keyIndex, 1);
    }
    keyUsage.push(cacheKey);

    const now = dateUtils.create();
    let cacheEntry = selectorCache.get(cacheKey);
    let isExpired = false;

    // Check if cache entry is expired
    if (cacheEntry && expireAfter && (now - cacheEntry.created > expireAfter)) {
      selectorCache.delete(cacheKey);
      cacheEntry = undefined;
      isExpired = true;
    }

    if (!cacheEntry) {
      // Create a new selector that closes over the specific parameters
      const memoizedSelector = createSelector(
        [(state: State) => state],
        (state) => selector(state, ...params),
        {
          memoizeOptions: {
            resultEqualityCheck: equalityCheck,
          },
        }
      );

      cacheEntry = {
        selector: memoizedSelector,
        lastUsed: now,
        created: now,
        hits: 0,
        misses: 1,
        executionTime: 0
      };

      selectorCache.set(cacheKey, cacheEntry);
      totalMisses++;

      // Clean up least recently used selectors if we exceed max size
      if (selectorCache.size > maxSize!) {
        const oldestKey = keyUsage.shift();
        if (oldestKey) {
          selectorCache.delete(oldestKey);
        }
      }

      if (logMisses) {
        const label = debugLabel ?? 'ParameterizedSelector';
        console.log(`${label} cache miss for key: ${cacheKey}`, {
          params,
          cacheSize: selectorCache.size,
          isExpired
        });
      }
    } else {
      // Update cache entry
      cacheEntry.lastUsed = now;
      cacheEntry.hits++;
      totalHits++;

      if (logHits) {
        const label = debugLabel ?? 'ParameterizedSelector';
        console.log(`${label} cache hit for key: ${cacheKey}`, {
          params,
          hits: cacheEntry.hits,
          cacheSize: selectorCache.size
        });
      }
    }

    return cacheEntry;
  };

  const computeResult = (state: State, cacheEntry: { selector: ReturnType<typeof createSelector>; executionTime: number }) => {
    const result = cacheEntry.selector(state);

    // Track performance
    if (trackPerformance) {
      const executionTime = performance.now() - cacheEntry.executionTime
      cacheEntry.executionTime += executionTime;
      totalExecutionTime += executionTime;
    }

    return result;
  };

  // Add metadata and utility methods to the selector
  Object.defineProperties(factorySelector, {
    clearCache: {
      value: function () {
        selectorCache.clear();
        keyUsage.length = 0;
      }
    },
    getStats: {
      value: function () {
        return {
          cacheSize: selectorCache.size,
          maxSize,
          totalHits,
          totalMisses,
          hitRate: totalHits / Math.max(1, totalHits + totalMisses),
          totalExecutionTime,
          averageExecutionTime: totalExecutionTime / Math.max(1, totalHits + totalMisses),
          entries: Array.from(selectorCache.entries()).map(([key, entry]) => ({
            key,
            hits: entry.hits,
            misses: entry.misses,
            lastUsed: entry.lastUsed,
            created: entry.created,
            executionTime: entry.executionTime,
            age: dateUtils.create() - entry.created
          }))
        };
      }
    },
    invalidateCache: {
      value: function (predicate?: (params: Params) => boolean) {
        if (!predicate) {
          (factorySelector as ExtendedFactorySelector<State, Result, Params>).clearCache();
          return;
        }

        const keysToRemove: string[] = [];

        selectorCache.forEach((_entry, key) => {
          try {
            const params = JSON.parse(key) as Params;
            if (predicate(params)) {
              keysToRemove.push(key);
            }
          } catch (e) {
            // If we can't parse the key, skip it
          }
        });

        keysToRemove.forEach(key => {
          selectorCache.delete(key);
          const keyIndex = keyUsage.indexOf(key);
          if (keyIndex > -1) {
            keyUsage.splice(keyIndex, 1);
          }
        });

        return keysToRemove.length;
      }
    },
    debugLabel: {
      value: debugLabel
    }
  });

  return factorySelector as ExtendedFactorySelector<State, Result, Params>;

  /**
   * Create a cache key from parameters
   * Handles special cases like functions, Maps, and Sets
   */
  function getCacheKeyForParams(params: Params): string {
    try {
      return JSON.stringify(params, (__, value) => {
        // Handle special cases like functions, maps, sets, etc.
        if (typeof value === 'function') {
          return `__fn_${value.name || 'anonymous'}_${value.toString().slice(0, 100)}`;
        }
        if (value instanceof Map) {
          return ['__Map', ...Array.from(value.entries())];
        }
        if (value instanceof Set) {
          return ['__Set', ...Array.from(value.values())];
        }
        if (value instanceof Date) {
          return ['__Date', value.toISOString()];
        }
        if (value instanceof RegExp) {
          return ['__RegExp', value.toString()];
        }
        if (value instanceof Error) {
          return ['__Error', value.name, value.message];
        }
        if (ArrayBuffer.isView(value)) {
          return ['__TypedArray', value.constructor.name, Array.from(value as any)];
        }
        return value;
      });
    } catch (error) {
      // If JSON serialization fails, use a fallback approach
      Sentry.captureException(error, {
        extra: {
          message: 'Failed to create cache key for parameterized selector',
          selectorLabel: debugLabel
        }
      });

      // Fallback to a less reliable but safer string representation
      return params.map(param => {
        if (param === null) return 'null';
        if (param === undefined) return 'undefined';
        if (typeof param === 'function') return `fn_${param.name || 'anonymous'}`;
        if (typeof param === 'object') return `obj_${Object.keys(param).join('_')}`;
        return String(param);
      }).join('|');
    }
  }
}

/**
 * Creates a selector with dependency tracking
 * 
 * @template State - The state type (usually RootState)
 * @template Result - The return type of the selector
 * @template Deps - The dependencies as a tuple
 * @param dependencies - The selector dependencies
 * @param combiner - The function that combines the dependencies
 * @param options - Configuration options
 */
export function createTrackedSelector<State, Result, Deps extends any[]>(
  dependencies: Array<(state: State) => any>,
  combiner: (...deps: Deps) => Result,
  options: {
    debugLabel?: string;
    trackPerformance?: boolean;
    trackDependencyChanges?: boolean;
  } = {}
) {
  const { debugLabel, trackPerformance = false, trackDependencyChanges = false } = options;

  let lastDeps: Deps | undefined;
  let changedDeps: number[] = [];
  let executionCount = 0;
  let totalExecutionTime = 0;

  const selector = createSelector(
    dependencies,
    (...deps: Deps) => {
      const startTime = trackPerformance ? performance.now() : 0;
      executionCount++;

      // Track which dependencies changed
      if (trackDependencyChanges && lastDeps) {
        changedDeps = deps.map((dep, i) =>
          dep !== lastDeps![i] ? i : -1
        ).filter(i => i !== -1);
      }

      lastDeps = [...deps] as Deps;

      const result = combiner(...deps);

      if (trackPerformance) {
        const executionTime = performance.now() - startTime;
        totalExecutionTime += executionTime;

        if (debugLabel && executionTime > 5) {
          console.warn(`Slow selector execution: ${debugLabel} took ${executionTime.toFixed(2)}ms`);
        }
      }

      return result;
    }
  );

  // Add metadata and utility methods to the selector
  Object.defineProperties(selector, {
    getStats: {
      value: function () {
        return {
          executionCount,
          totalExecutionTime,
          averageExecutionTime: totalExecutionTime / Math.max(1, executionCount),
          lastChangedDependencies: changedDeps,
          dependencyCount: dependencies.length
        };
      }
    },
    debugLabel: {
      value: debugLabel
    },
    resetStats: {
      value: function () {
        executionCount = 0;
        totalExecutionTime = 0;
        changedDeps = [];
      }
    }
  });

  return selector as typeof selector & {
    getStats: () => {
      executionCount: number;
      totalExecutionTime: number;
      averageExecutionTime: number;
      lastChangedDependencies: number[];
      dependencyCount: number;
    };
    debugLabel?: string;
    resetStats: () => void;
  };
}

/**
 * Creates a selector factory that accepts a state path
 * 
 * @template State - The state type (usually RootState)
 * @template Result - The return type of the selector
 * @param getPath - Function to get the path from parameters
 * @param transform - Optional transform function
 */
export function createPathSelector<State extends BaseCommonState, Result = any>(
  getPath: (state: State, ...params: any[]) => any,
  transform?: (value: any, state: State, ...params: any[]) => Result
) {
  return createParameterizedSelector(
    (state: State, ...params: any[]): Result => {
      const value = getPath(state, ...params);
      return transform ? transform(value, state, ...params) : value;
    },
    {
      maxSize: 20,
      debugLabel: 'PathSelector'
    }
  );
}

/**
 * Creates a selector that filters an array based on criteria
 * 
 * @template State - The state type (usually RootState)
 * @template T - The array item type
 * @param arraySelector - Selector that returns the array
 * @param predicate - Filter predicate function
 */
export function createFilteredSelector<State, T>(
  arraySelector: (state: State) => T[],
  predicate: (item: T, state: State, ...params: any[]) => boolean
) {
  return createParameterizedSelector(
    (state: State, ...params: any[]): T[] => {
      const array = arraySelector(state);
      return array.filter(item => predicate(item, state, ...params));
    },
    {
      maxSize: 15,
      debugLabel: 'FilteredSelector'
    }
  );
}

/**
 * Creates a selector that sorts an array
 * 
 * @template State - The state type (usually RootState)
 * @template T - The array item type
 * @param arraySelector - Selector that returns the array
 * @param compareFn - Sort compare function
 */
export function createSortSelector<State, T>(
  arraySelector: (state: State) => T[],
  compareFn: (a: T, b: T, state: State, ...params: any[]) => number
) {
  return createParameterizedSelector(
    (state: State, ...params: any[]): T[] => {
      const array = arraySelector(state);
      return [...array].sort((a, b) => compareFn(a, b, state, ...params));
    },
    {
      maxSize: 10,
      debugLabel: 'SortSelector'
    }
  );
}

/**
 * Creates a selector that paginates an array
 * 
 * @template State - The state type (usually RootState)
 * @template T - The array item type
 * @param arraySelector - Selector that returns the array
 */
export function createPaginationSelector<State, T>(
  arraySelector: (state: State) => T[]
) {
  return createParameterizedSelector(
    (state: State, page: number = 0, pageSize: number = 10): {
      items: T[];
      pagination: {
        totalItems: number;
        totalPages: number;
        currentPage: number;
        pageSize: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    } => {
      const array = arraySelector(state);
      const totalItems = array.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const normalizedPage = Math.max(0, Math.min(page, totalPages - 1));

      const start = normalizedPage * pageSize;
      const end = start + pageSize;
      const items = array.slice(start, end);

      return {
        items,
        pagination: {
          totalItems,
          totalPages,
          currentPage: normalizedPage,
          pageSize,
          hasNextPage: normalizedPage < totalPages - 1,
          hasPreviousPage: normalizedPage > 0
        }
      };
    },
    {
      maxSize: 20,
      debugLabel: 'PaginationSelector'
    }
  );
}

/**
 * Creates a selector that combines multiple parameterized selectors
 * 
 * @template State - The state type (usually RootState)
 * @template Selectors - The selector types
 * @template Result - The return type
 * @param selectors - The selectors to combine
 * @param combiner - Function to combine the results
 */
export function combineParameterizedSelectors<
  State,
  Selectors extends Array<(state: State, ...params: any[]) => any>,
  Result
>(
  selectors: Selectors,
  combiner: (...results: { [K in keyof Selectors]: ReturnType<Selectors[K]> }) => Result
) {
  return createParameterizedSelector(
    (state: State, ...params: any[]): Result => {
      const results = selectors.map(selector => selector(state, ...params)) as any;
      return combiner(...results);
    },
    {
      maxSize: 10,
      debugLabel: 'CombinedSelector'
    }
  );
}

export default {
  createParameterizedSelector,
  createTrackedSelector,
  createPathSelector,
  createFilteredSelector,
  createSortSelector,
  createPaginationSelector,
  combineParameterizedSelectors
};
