import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSelector } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/react';
import { BaseCommonState, DeviceInfo, NetworkInfo } from '../../lib/types/commonTypes';
import dateUtils from '../../lib/utils/dateUtils';
import {
  createParameterizedSelector,
  createTrackedSelector,
  createPathSelector,
  createFilteredSelector,
  createSortSelector,
  createPaginationSelector,
  combineParameterizedSelectors
} from '../../lib/utils/selectorUtils';
import { Status, DeviceType } from '../../lib/types/baseTypes';

interface TestState extends BaseCommonState {
  items: Array<{ id: number; value: string }>;
  nested: {
    data: {
      count: number;
    };
  };
}

describe('selectorUtils', () => {
  let mockState: TestState;

  beforeEach(() => {
    jest.useFakeTimers();

    const mockNetworkInfo: NetworkInfo = {
      type: 'unknown',
      effectiveType: 'unknown',
      downlink: 0,
      rtt: 0,
    };

    const mockDeviceInfo: DeviceInfo = {
      id: 'test-device',
      deviceId: 'test-device-id',
      deviceType: DeviceType.UNKNOWN,
      isDesktop: false,
      isMobile: false,
      isTablet: false,
      platform: {
        type: 'test-platform',
        os: { name: 'test-os', version: '1.0' },
        browser: { name: 'test-browser', version: '1.0' }
      },
      userAgent: 'test-user-agent',
      language: 'en',
      timeZone: 'UTC',
      screen: { width: 1920, height: 1080, pixelRatio: 1, path: '/' },
      network: mockNetworkInfo,
      privacy: { doNotTrack: false, gdprCompliant: true },
      browserLanguage: 'en',
      browserLocale: 'en-US',
      timeZoneOffset: 0,
      lastActivityTime: dateUtils.create(),
    };

    mockState = {
      items: [
        { id: 1, value: 'one' },
        { id: 2, value: 'two' },
        { id: 3, value: 'three' }
      ],
      nested: {
        data: {
          count: 42
        }
      },
      status: Status.IDLE,
      errors: {},
      loadingTasks: {},
      isLoading: false,
      lastUpdated: dateUtils.create(),
      deviceInfo: mockDeviceInfo,
      lastMutationTimestamp: dateUtils.create(),
      retryOperations: {},
      lastSnapshotId: '',
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('createParameterizedSelector', () => {
    it('should handle complex parameter types', () => {
      const selector = createParameterizedSelector(
        (state: TestState, fn: () => void, map: Map<string, number>) => {
          return state.items.length + map.size;
        }
      );

      const testFn = () => {};
      const testMap = new Map([['a', 1], ['b', 2]]);
      
      const result = selector(mockState, testFn, testMap);
      expect(result).toBe(5);

      const cachedResult = selector(mockState, testFn, testMap);
      expect(cachedResult).toBe(5);

      const stats = selector.getStats();
      expect(stats.totalHits).toBe(1);
    });

    it('should handle cache invalidation with predicate', () => {
      const selector = createParameterizedSelector(
        (state: TestState, id: number) => state.items.find(item => item.id === id)
      );

      selector(mockState, 1);
      selector(mockState, 2);
      selector(mockState, 3);

      const removedCount = selector.invalidateCache((params) => params[0] > 1);
      expect(removedCount).toBe(2);

      const stats = selector.getStats();
      expect(stats.cacheSize).toBe(1);
    });
  });

  describe('createTrackedSelector', () => {
    it('should track dependency changes', () => {
      const itemsSelector = (state: TestState) => state.items;
      const countSelector = (state: TestState) => state.nested.data.count;

      const selector = createTrackedSelector(
        [itemsSelector, countSelector],
        (items, count) => ({ total: items.length + count }),
        { trackDependencyChanges: true }
      );

      selector(mockState);
      const newState = {
        ...mockState,
        nested: { data: { count: 43 } }
      };
      selector(newState);

      const stats = selector.getStats();
      expect(stats.lastChangedDependencies).toEqual([1]);
      expect(stats.executionCount).toBe(2);
    });
  });

  describe('createPathSelector', () => {
    it('should handle nested paths with transform', () => {
      const selector = createPathSelector<TestState, string>(
        (state) => state.nested.data.count,
        (value) => `Count: ${value}`
      );

      const result = selector(mockState);
      expect(result).toBe('Count: 42');
    });
  });

  describe('createFilteredSelector', () => {
    it('should filter with additional parameters', () => {
      const selector = createFilteredSelector(
        (state: TestState) => state.items,
        (item, _, minId: number) => item.id >= minId
      );

      const result = selector(mockState, 2);
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe(2);
    });
  });

  describe('createSortSelector', () => {
    it('should sort with custom compare function', () => {
      const selector = createSortSelector(
        (state: TestState) => state.items,
        (a, b, _, reverse: boolean) => reverse ? 
          b.value.localeCompare(a.value) : 
          a.value.localeCompare(b.value)
      );

      const result = selector(mockState, true);
      expect(result[0]!.value).toBe('two');
      expect(result[2]!.value).toBe('one');
    });
  });

  describe('createPaginationSelector', () => {
    it('should handle edge cases in pagination', () => {
      const selector = createPaginationSelector(
        (state: TestState) => state.items
      );

      const { items, pagination } = selector(mockState, 5, 2);
      expect(items).toHaveLength(0);
      expect(pagination.currentPage).toBe(1);
      expect(pagination.hasNextPage).toBe(false);
    });
  });

  describe('combineParameterizedSelectors', () => {
    it('should combine multiple selectors with shared parameters', () => {
      const filterSelector = createFilteredSelector(
        (state: TestState) => state.items,
        (item, _, minId: number) => item.id >= minId
      );

      const sortSelector = createSortSelector(
        (state: TestState) => state.items,
        (a, b) => a.id - b.id
      );

      const combined = combineParameterizedSelectors<
        TestState,
        [typeof filterSelector, typeof sortSelector],
        { filtered: number; sorted: number[] }
      >(
        [filterSelector, sortSelector],
        (filtered, sorted) => ({
          filtered: filtered.length,
          sorted: sorted.map(i => i.id)
        })
      );

      const result = combined(mockState, 2);
      expect(result.filtered).toBe(2);
      expect(result.sorted).toEqual([1, 2, 3]);
    });
  });
});

 PASS  tests/utils/selectorUtils.test.ts
  selectorUtils
    createParameterizedSelector                                                                                                                                                                                             
      √ should handle complex parameter types (7 ms)                                                                                                                                                                        
      √ should handle cache invalidation with predicate (2 ms)                                                                                                                                                              
    createTrackedSelector                                                                                                                                                                                                   
      √ should track dependency changes (2 ms)                                                                                                                                                                              
    createPathSelector                                                                                                                                                                                                      
      √ should handle nested paths with transform (1 ms)                                                                                                                                                                    
    createFilteredSelector                                                                                                                                                                                                  
      √ should filter with additional parameters (1 ms)                                                                                                                                                                     
    createSortSelector                                                                                                                                                                                                      
      √ should sort with custom compare function (19 ms)                                                                                                                                                                    
    createPaginationSelector                                                                                                                                                                                                
      √ should handle edge cases in pagination (2 ms)                                                                                                                                                                       
    combineParameterizedSelectors                                                                                                                                                                                           
      √ should combine multiple selectors with shared parameters (3 ms)                                                                                                                                                     
                                                                                                                                                                                                                            
Test Suites: 1 passed, 1 total                                                                                                                                                                                              
Tests:       8 passed, 8 total                                                                                                                                                                                              
Snapshots:   0 total
Time:        3.095 s
