// <reference types="user-agent-data-types" />
// <reference types="web-vitals" />

// Imports from libraries and local utils

import { UAParser } from 'ua-parser-js';
import { onCLS, onINP, onLCP } from 'web-vitals';
import { z } from 'zod';
import { dateUtils, Timestamp } from './dateUtils';
import { DeviceInfo, toTimestamp } from '../types/commonTypes';
import { _RawEnvironmentDataSchema, IpInfoSchema } from '../utils/schemas';




// Define error types for better error handling
export interface EnvironmentServiceError {
  code: string;
  message: string;
  timestamp: Timestamp;
  context?: Record<string, unknown>;
}

// Result type for operations that might fail
export type Result<T> =
  | { success: true; data: T; }
  | { success: false; error: EnvironmentServiceError; };

// Define base schemas for performance entries
export const BasePerformanceEntrySchema = z.object({
  entryType: z.string(),
  startTime: z.number(),
  name: z.string().optional().default(''),
  duration: z.number().optional().default(0),
});

export const BaseNavigationTimingSchema = z.object({
  entryType: z.string(),
  startTime: z.number(),
  serverTiming: z.array(z.object({
    name: z.string(),
    duration: z.number(),
    description: z.string().optional(),
  })).optional(),
});

/// -----------------------------
// CLIENT ENVIRONMENT GUARD
// -----------------------------
const isClient = typeof window !== 'undefined';

// Logger for better debugging and monitoring
const logger = {
  info: (message: string, data?: any) => {
    console.info(`[EnvironmentService] ${message}`, data);
  },
  warn: (message: string, error?: any) => {
    console.warn(`[EnvironmentService] ${message}`, error);
  },
  error: (message: string, error: any) => {
    console.error(`[EnvironmentService] ${message}`, error);
    // Could also send to error tracking service
  }
};

// Define network type string literal types
type NetworkTypeString = 'unknown' | 'wifi' | '4g' | 'ethernet' | '2g' | '3g' | '5g' | 'slow-2g';

// Create a type guard function to validate network types

/**
 * Retrieves environment data including browser/device/OS details,
 * screen info, network and privacy settings, performance metrics, and geolocation.
 */
export class EnvironmentService {
  private static instance: EnvironmentService | null = null;
  private readonly parser = new UAParser();
  private cache: {
    data: z.infer<typeof _RawEnvironmentDataSchema>;
    timestamp: Timestamp;
  } | null = null;
  private collectingPromise: Promise<z.infer<typeof _RawEnvironmentDataSchema>> | null = null;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private static readonly DEVICE_ID_KEY = 'deviceId';

  // Event listeners for real-time updates
  private networkChangeListeners: Array<() => void> = [];
  private visibilityChangeListeners: Array<() => void> = [];

  private constructor() {
    if (!isClient) {
      // This path should ideally not be hit due to getInstance guard
      console.error("EnvironmentService constructor illegally called on server!");
      // Avoid throwing here, let getInstance return null
      return;
    }
    // These lines are safe because constructor is now guarded by getInstance
    this.parser.setUA(navigator.userAgent);
    this.setupEventListeners();
  }

  /**
   * Sets up event listeners for important browser events
   */
  private setupEventListeners(): void {
    try {
      // Update network info when connection changes
      if ('connection' in navigator && (navigator as any).connection) {
        const updateNetworkInfo = this.throttle(() => {
          logger.info('Network connection changed, updating info');
          if (this.cache?.data) {
            this.cache.data.network = this.getNetworkInfo();
          }
        }, 2000);

        (navigator as any).connection.addEventListener('change', updateNetworkInfo);
        this.networkChangeListeners.push(updateNetworkInfo);
      }

      // Update when visibility changes (tab focus/blur)
      const updateVisibility = this.throttle(() => {
        logger.info(`Document visibility changed: ${document.visibilityState}`);
        if (document.visibilityState === 'visible' && this.cache?.data) {
          this.cache.data.lastActivityTime = toTimestamp(dateUtils.create());
        }
      }, 1000);

      document.addEventListener('visibilitychange', updateVisibility);
      this.visibilityChangeListeners.push(updateVisibility);

      logger.info('Event listeners set up successfully');
    } catch (error) {
      logger.error('Failed to setup event listeners', error);
    }
  }

  /**
   * Throttles a function to prevent excessive calls
   */
  private throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => ReturnType<T> | undefined {
    let inThrottle = false;
    let lastResult: ReturnType<T>;

    return function (this: any, ...args: Parameters<T>): ReturnType<T> | undefined {
      if (!inThrottle) {
        lastResult = func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
      return lastResult;
    };
  }

  public static getInstance(): EnvironmentService | null {
    // --- Add SSR Guard --- Return null immediately if not client
    if (!isClient) {
      return null;
    }
    // --- End SSR Guard ---

    // If instance doesn't exist, try to create it (only runs on client now)
    if (!EnvironmentService.instance) {
      try {
        EnvironmentService.instance = new EnvironmentService();
      } catch (error) {
        logger.error("Failed to create EnvironmentService instance", error);
        EnvironmentService.instance = null; // Ensure null on creation error
      }
    }
    // Return the potentially null instance
    return EnvironmentService.instance;
  }

  private isCacheValid(): boolean {
    return !!(this.cache && dateUtils.create() - this.cache.timestamp < this.CACHE_DURATION);
  }

  /**
   * Collects environment data with configurable options
   * 
   * @param options Configuration options for data collection
   */
  public async collectEnvironmentData(options: {
    includePerformance?: boolean,
    includeGeolocation?: boolean
  } = {}): Promise<z.infer<typeof _RawEnvironmentDataSchema>> {
    const startTime = performance.now();
    try {
      // Return cached data if valid
      if (this.isCacheValid()) {
        logger.info('Returning cached environment data');
        return this.cache!.data;
      }

      // Return existing promise if collection is in progress
      if (this.collectingPromise) {
        logger.info('Collection already in progress, returning existing promise');
        return this.collectingPromise;
      }

      logger.info('Starting fresh environment data collection', options);
      this.collectingPromise = this.collectFreshEnvironmentData(options);
      const data = await this.collectingPromise;

      // Cache the result
      this.cache = {
        data,
        timestamp: dateUtils.create(),
      };

      const duration = performance.now() - startTime;
      logger.info(`Environment data collection completed in ${duration.toFixed(2)}ms`);
      this.recordTelemetry('collect_success', { duration });

      return data;
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error('Failed to collect environment data', error);
      this.recordTelemetry('collect_error', {
        duration,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      return EnvironmentService.getFallbackDeviceInfo();
    } finally {
      this.collectingPromise = null;
    }
  }
  /**
   * Records telemetry data for monitoring service health
   */
  private recordTelemetry(event: string, data?: Record<string, any>): void {
    // Implementation depends on your telemetry system
    // This is a placeholder for the actual implementation
    if (typeof window !== 'undefined' && 'telemetry' in window) {
      try {
        (window as any).telemetry?.record('environment_service', {
          event,
          timestamp: dateUtils.create(),
          ...data
        });
      } catch (error) {
        logger.error('Failed to record telemetry', error);
      }
    }
  }

  private async collectFreshEnvironmentData(options: {
    includePerformance?: boolean,
    includeGeolocation?: boolean
  } = {}): Promise<z.infer<typeof _RawEnvironmentDataSchema>> {
    const promises: Array<Promise<any>> = [];

    // Only collect performance metrics if requested
    if (options.includePerformance !== false) {
      promises.push(this.collectWebVitals());
    } else {
      promises.push(Promise.resolve(null));
    }

    // Only collect geolocation if requested
    if (options.includeGeolocation) {
      promises.push(this.getGeolocation());
    } else {
      promises.push(Promise.resolve(null));
    }

    const [webVitals = { lcp: null, fid: null, cls: null }, geolocation = { latitude: null, longitude: null, accuracy: null }] =
      await Promise.all(promises);

    const networkInfo = this.getNetworkInfo();
    const platformDetails = this.getPlatformInfoInternal();
    const userAgent = navigator.userAgent;
    const deviceType = this.getDeviceType(userAgent);

    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    // Helper to map PerformanceEntry to schema type
    const mapPerformanceEntry = (entry: PerformanceEntry | undefined): z.infer<typeof BasePerformanceEntrySchema> | null => {
      if (!entry) return null;
      // Basic mapping - ensure BasePerformanceEntrySchema matches expected fields
      return {
        entryType: entry.entryType,
        startTime: entry.startTime,
        name: entry.name ?? '',
        duration: entry.duration ?? 0,
      };
    };

    // Helper to map PerformanceNavigationTiming to schema type (Type-Safe Version)
    const mapNavigationTiming = (entry: PerformanceNavigationTiming | undefined): z.infer<typeof BaseNavigationTimingSchema> | null => {
      if (!entry) return null;

      // Map serverTiming safely, ensuring it matches the schema's expected structure
      const mappedServerTiming = entry.serverTiming?.map(st => ({
        name: st.name ?? 'unknown',
        duration: st.duration ?? 0,
        description: st.description ?? undefined,
      })) ?? undefined;

      // Construct the object matching the schema explicitly
      const mappedData = {
        entryType: entry.entryType ?? 'navigation',
        startTime: entry.startTime ?? 0,
        serverTiming: mappedServerTiming,
      };

      return mappedData as z.infer<typeof BaseNavigationTimingSchema>;
    };

    const browserLanguage = navigator.language ?? 'en';
    const browserLocale = navigator.languages?.[0] ?? 'en-US';
    const timeZoneOffset = new Date().getTimezoneOffset();
    const screenWidth = typeof window !== 'undefined' ? window.screen.width : 0;
    const screenHeight = typeof window !== 'undefined' ? window.screen.height : 0;

    // Construct the object matching the schema
    const dataToParse = {
      id: crypto.randomUUID(),
      deviceId: this.getOrCreateDeviceId(),
      platform: {
        type: deviceType,
        os: platformDetails.browser.name !== 'unknown' ? {
          name: platformDetails.platform,
          version: 'unknown',
        } : { name: 'unknown', version: 'unknown' },
        browser: platformDetails.browser,
      },
      userAgent: userAgent,
      language: browserLanguage,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      isDesktop: deviceType === DeviceType.DESKTOP,
      isMobile: deviceType === DeviceType.MOBILE,
      isTablet: deviceType === DeviceType.TABLET,
      screen: {
        width: screenWidth >= 0 ? screenWidth : 0,
        height: screenHeight >= 0 ? screenHeight : 0,
        pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio ?? 1 : 1,
        path: typeof window !== 'undefined' ? window.location.pathname : '/',
      },
      network: networkInfo,
      performance: {
        navigation: mapNavigationTiming(navigationEntry),
        webVitals: {
          ...webVitals,
          navigationTiming: mapPerformanceEntry(navigationEntry),
          resourceTiming: [],
        },
        resources: [],
      },
      privacy: this.getPrivacyInfo(),
      geolocation,
      lastActivityTime: toTimestamp(dateUtils.create()),
      deviceType: deviceType,
      browserLanguage,
      browserLocale,
      timeZoneOffset,
      lastIp: 'unknown',
    };

    try {
      console.log('Data before validation:', JSON.stringify(dataToParse, null, 2)); // DEBUG LOG
      // Validate the data against the schema
      return _RawEnvironmentDataSchema.parse(dataToParse);
    } catch (error) {
      logger.error('Environment data validation failed', error);
      throw error;
    }
  }

  /**
   * Creates or retrieves a persistent device ID
   */
  private getOrCreateDeviceId(): string {
    try {
      let deviceId = localStorage.getItem(EnvironmentService.DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId =
          crypto.randomUUID?.() ??
          Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        localStorage.setItem(EnvironmentService.DEVICE_ID_KEY, deviceId);
        logger.info('Created new device ID', { deviceId });
      }
      return deviceId;
    } catch (error) {
      logger.warn('Failed to get/create device ID', error);
      return crypto.randomUUID?.() ?? 'unknown';
    }
  }

  public getPlatformInfo(): {
    platform: string;
    deviceType: DeviceType;
    userAgent: string;
  } {
    const userAgent = navigator.userAgent;
    const platformInfo = this.getPlatformInfoInternal();
    const deviceType = this.getDeviceType(userAgent);

    return {
      platform: platformInfo.platform,
      deviceType,
      userAgent,
    };
  }

  private getPlatformInfoInternal(): {
    platform: string;
    deviceType: DeviceType;
    browser: { name: string; version: string };
  } {
    const userAgent = navigator.userAgent;
    const userAgentData = (navigator as any).userAgentData;

    const platform = this.getOSInfo(userAgentData).name;
    const browser = this.getBrowserInfo();

    return {
      platform,
      deviceType: this.getDeviceType(userAgent),
      browser,
    };
  }

  private getDeviceType(userAgent: string): DeviceType {
    // Check for Tablet or iPad FIRST
    if (userAgent.includes('Tablet') ?? userAgent.includes('iPad')) {
      return DeviceType.TABLET;
      // Then check for Mobile/iPhone/Android
    } else if (userAgent.includes('Mobile') ?? userAgent.includes('iPhone') ?? userAgent.includes('Android')) {
      return DeviceType.MOBILE;
      // Otherwise, assume Desktop
    } else {
      return DeviceType.DESKTOP;
    }
  }

  private getOSInfo(highEntropyValues: any): { name: string; version: string } {
    const userAgentData = (navigator as any).userAgentData;

    if (highEntropyValues?.platform && highEntropyValues?.platformVersion) {
      // Use high entropy values if available
      return {
        name: highEntropyValues.platform,
        version: highEntropyValues.platformVersion,
      };
    }

    if (userAgentData) {
      // Fallback to low entropy platform
      return {
        name: userAgentData.platform,
        version: 'unknown', // Platform version not available in basic UA-CH
      };
    }

    // Fallback to UA parser
    const osInfo = this.parser.getOS();
    return {
      name: osInfo.name ?? 'unknown',
      version: osInfo.version ?? 'unknown',
    };
  }

  private getNetworkInfo(): {
    type: NetworkTypeString;
    effectiveType: NetworkTypeString;
    downlink: number;
    rtt: number;
  } {
    const connection = (navigator as any).connection ?? {};

    const determineNetworkType = (conn: any): NetworkTypeString => {
      if (!conn.type) return 'unknown';

      // Map connection type to NetworkType
      const typeMap: Record<string, NetworkTypeString> = {
        bluetooth: 'unknown',
        cellular: '4g',
        ethernet: 'ethernet',
        wifi: 'wifi',
        none: 'unknown',
      };

      return typeMap[conn.type] ?? 'unknown';
    };

    const effectiveType = connection.effectiveType ?? 'unknown';
    const effectiveTypeMap: Record<string, NetworkTypeString> = {
      '2g': '2g',
      '3g': '3g',
      '4g': '4g',
      '5g': '5g'
    };
    const effectiveNetworkType = effectiveTypeMap[effectiveType] ?? 'unknown';

    return {
      type: determineNetworkType(connection),
      effectiveType: effectiveNetworkType,
      downlink: connection.downlink ?? 0,
      rtt: connection.rtt ?? 0,
    };
  }

  private getPrivacyInfo(): { doNotTrack: boolean; gdprCompliant: boolean } {
    return {
      doNotTrack:
        navigator.doNotTrack === '1' ||
        (window as any).doNotTrack === '1' ||
        (navigator as any).msDoNotTrack === '1',
      gdprCompliant: 'globalPrivacyControl' in navigator,
    };
  }

  /**
   * Collects web vitals metrics with a timeout
   */
  private async collectWebVitals(): Promise<{
    lcp: number | null;
    fid: number | null;
    cls: number | null;
  }> {
    return new Promise((resolve) => {
      let metricsCollected = 0;
      const metrics = {
        lcp: null as number | null,
        fid: null as number | null,
        cls: null as number | null,
      };

      const checkComplete = () => {
        if (metricsCollected === 3) {
          resolve(metrics);
        }
      };

      onLCP((metric: any) => {
        metrics.lcp = metric.value;
        metricsCollected++;
        checkComplete();
      });

      onINP((metric: any) => {
        metrics.fid = metric.value;
        metricsCollected++;
        checkComplete();
      });

      onCLS((metric: any) => {
        metrics.cls = metric.value;
        metricsCollected++;
        checkComplete();
      });

      // Timeout after 3 seconds
      setTimeout(() => resolve(metrics), 3000);
    });
  }

  private getBrowserInfo(): {
    name: string;
    version: string;
  } {
    // Modern approach using User-Agent Client Hints
    const userAgentData = (navigator as any).userAgentData;
    if (userAgentData) {
      return {
        name: userAgentData.brands[0]?.brand ?? 'unknown',
        version: userAgentData.brands[0]?.version ?? 'unknown',
      };
    }

    // Fallback to UA parser
    const browserInfo = this.parser.getBrowser();
    return {
      name: browserInfo.name ?? 'unknown',
      version: browserInfo.version ?? 'unknown',
    };
  }

  private async getGeolocation() {
    if (!navigator.geolocation) {
      return { latitude: null, longitude: null, accuracy: null };
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 60000,
          enableHighAccuracy: false
        })
      );

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
    } catch (error) {
      logger.warn('Failed to get geolocation', error);
      return { latitude: null, longitude: null, accuracy: null };
    }
  }

  public getLastCollectedData(): z.infer<typeof _RawEnvironmentDataSchema> | null {
    return this.cache?.data ?? null;
  }

  /**
   * Returns fallback device info when data collection fails
   */
  public static getFallbackDeviceInfo(): z.infer<typeof _RawEnvironmentDataSchema> {
    return {
      id: 'fallback-device-id',
      deviceId: 'fallback-device-id',
      platform: {
        type: 'unknown',
        os: {
          name: 'Unknown',
          version: '0.0',
        },
        browser: {
          name: 'Unknown',
          version: '0.0',
        },
      },
      userAgent: 'Unknown',
      language: 'en',
      timeZone: 'UTC',
      isDesktop: false,
      isMobile: false,
      isTablet: false,
      screen: {
        width: 0,
        height: 0,
        pixelRatio: 1,
        path: '/',
      },
      deviceType: DeviceType.UNKNOWN,
      network: {
        type: 'unknown',
        effectiveType: 'unknown',
        downlink: 0,
        rtt: 0,
      },
      performance: {
        webVitals: {
          lcp: null,
          fid: null,
          cls: null,
          navigationTiming: null,
          resourceTiming: [],
        },
        navigation: null,
        resources: [],
      },
      geolocation: {
        latitude: null,
        longitude: null,
        accuracy: null,
      },
      privacy: {
        doNotTrack: false,
        gdprCompliant: false,
      },
      browserLanguage: 'en',
      browserLocale: 'en-US',
      timeZoneOffset: 0,
      lastActivityTime: toTimestamp(dateUtils.create()),
      lastIp: 'unknown',
    };
  }

  /**
   * Collects minimal environment data based on purpose
   */
  public collectMinimalEnvironmentData(purpose: 'analytics' | 'debugging' | 'personalization'): Partial<any> {
    const baseData = {
      deviceId: this.getOrCreateDeviceId(),
      deviceType: this.getDeviceType(navigator.userAgent),
    };

    if (purpose === 'analytics') {
      return {
        ...baseData,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
        },
        language: navigator.language,
      };
    }

    if (purpose === 'debugging') {
      return {
        ...baseData,
        userAgent: navigator.userAgent,
        platform: this.getPlatformInfoInternal(),
      };
    }

    // Return appropriate data for personalization
    return {
      ...baseData,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /**
   * Fetches IP information using a circuit breaker pattern
   */
  public async getIpInfo(): Promise<Result<z.infer<typeof IpInfoSchema>>> {
    const token = process.env.IPINFO_TOKEN;
    if (!token) {
      return {
        success: false,
        error: {
          code: 'IP_INFO_TOKEN_MISSING',
          message: 'IPInfo token is missing.',
          timestamp: dateUtils.create()
        }
      };
    }

    try {
      const response = await fetchWithRetry(`https://ipinfo.io/json?token=${token}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch IP info: ${response.statusText}`);
      }

      const data = await response.json() as Partial<z.infer<typeof IpInfoSchema>>;
      logger.info('Fetched IP info successfully');

      return {
        success: true,
        data: {
          hasError: false,
          ip: 'ip' in data ? (data.ip ?? 'unknown') : 'unknown',
          hostname: 'hostname' in data ? (data.hostname ?? '') : '',
          city: 'city' in data ? (data.city ?? '') : '',
          region: 'region' in data ? (data.region ?? '') : '',
          country: 'country' in data ? (data.country ?? '') : '',
          loc: 'loc' in data ? (data.loc ?? '') : '',
          org: 'org' in data ? (data.org ?? '') : '',
          postal: 'postal' in data ? (data.postal ?? '') : '',
          timezone: 'timezone' in data ? (data.timezone ?? '') : '',
        }
      };
    } catch (error) {
      logger.error('Failed to get IP info', error);

      // Return error result
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: dateUtils.create()
        }
      };
    }
  }

  /**
   * Aggregates environment and IP data
   */
  public async getExternalData(): Promise<z.infer<typeof _RawEnvironmentDataSchema>> {
    const environment = await this.collectEnvironmentData();
    const ipInfo = await this.getIpInfo();

    // Use only ipInfo data if successful
    const ipData = ipInfo.success ? ipInfo.data : null;

    return _RawEnvironmentDataSchema.parse({
      ...environment,
      performance: environment.performance,
      lastIp: ipData?.ip ?? environment.lastIp ?? 'unknown',
    });
  }

  /**
   * Gets current screen information
   */
  public getScreenInfo(): {
    width: number;
    height: number;
    pixelRatio: number;
    path: string;
  } {
    return {
      width: window.screen.width,
      height: window.screen.height,
      pixelRatio: window.devicePixelRatio,
      path: window.location.pathname,
    };
  }

  /**
   * Cleanup method to remove event listeners
   */
  public dispose(): void {
    // Clean up network change listeners
    if ('connection' in navigator && (navigator as any).connection) {
      this.networkChangeListeners.forEach(listener => {
        (navigator as any).connection.removeEventListener('change', listener);
      });
    }

    // Clean up visibility change listeners
    this.visibilityChangeListeners.forEach(listener => {
      document.removeEventListener('visibilitychange', listener);
    });

    this.networkChangeListeners = [];
    this.visibilityChangeListeners = [];

    logger.info('EnvironmentService disposed');
  }
}

// -----------------------------
// FETCH WITH RETRY HELPER
// -----------------------------
/**
 * Performs a fetch request using exponential backoff retry logic.
 */
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response) throw new Error('Fetch returned undefined response');
      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText ?? response.status}`);
      }
      return response;
    } catch (error) {
      logger.warn(`Fetch attempt ${attempt} failed for ${url}:`, error);
      if (attempt === retries) {
        logger.error(`Fetch failed after ${retries} attempts for ${url}.`, error);
        throw error; // Re-throw the last error
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  // For type-safety, though this return should never be reached.
  throw new Error('fetchWithRetry: exhausted retries');
};

// -----------------------------
// EXTERNAL DATA AGGREGATION FUNCTION
// -----------------------------
/**
 * Aggregates all data—environment, geolocation, performance, and IP info—into one object.
 */
export const getExternalData = async (
  includeOptional = false
): Promise<z.infer<typeof _RawEnvironmentDataSchema>> => {
  const environmentService = EnvironmentService.getInstance();

  // Handle SSR case where service is not available
  if (!environmentService) {
    console.warn("[getExternalData] EnvironmentService not available (SSR?). Returning fallback data.");
    return EnvironmentService.getFallbackDeviceInfo(); // Use the static fallback method
  }

  // Service exists, proceed with data collection
  const environment = await environmentService.collectEnvironmentData({
    includeGeolocation: includeOptional,
    includePerformance: true // Assuming performance is always needed or handled internally
  });

  let ipInfo = null;
  if (includeOptional) {
    // Service instance is guaranteed to exist here
    const ipInfoResult = await environmentService.getIpInfo();
    // Safely check success before accessing data
    if (ipInfoResult.success) {
      ipInfo = ipInfoResult.data;
    } else {
      console.warn("[getExternalData] Failed to get IP info:", ipInfoResult.error);
    }
  }

  try {
    // Environment is guaranteed to be defined here
    return _RawEnvironmentDataSchema.parse({
      ...environment,
      // Ensure performance exists before accessing, though collectEnvironmentData should provide it
      performance: environment.performance ?? EnvironmentService.getFallbackDeviceInfo().performance,
      lastIp: ipInfo?.ip ?? environment.lastIp ?? 'unknown', // Use ipInfo if available, else fallback
    });
  } catch (error) {
    console.error("[getExternalData] Failed to parse final environment data:", error);
    // Return fallback if parsing fails
    return EnvironmentService.getFallbackDeviceInfo();
  }
};

// -----------------------------
// SERVER COMMUNICATION: CAPTURE AND SEND DATA
// -----------------------------
/**
 * Sanitizes input to prevent XSS
 */
const sanitizeInput = (input: string): string => {
  return input.replace(/[<>]/g, ''); // Simple XSS prevention
};

/**
 * Captures external data, enriches it with metadata, and sends it to the server endpoint.
 */
export const captureAndSendExternalData = async () => {
  try {
    const externalData = await getExternalData(true);

    const metadata = {
      timestamp: new Date().toISOString(),
      pageUrl: sanitizeInput(window.location.href),
    };
    const payload = { ...externalData, metadata };

    await fetchWithRetry('https://your-server.com/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    logger.info('Data successfully sent to the server.');
  } catch (error) {
    logger.error('Sending external data failed', error);
  }
};

// --> ADDED: Exported function to map environment data to DeviceInfo
/**
 * Maps environment data from EnvironmentService to DeviceInfo format
 */
export function mapEnvironmentToDeviceInfo(data: any): DeviceInfo {
  // Implement mapping logic based on your schema
  // Use `toTimestamp` for consistency
  return {
    lastActivityTime: toTimestamp(dateUtils.create()),
    id: data.id ?? 'unknown',
    deviceId: data.deviceId ?? 'unknown',
    deviceType: data.deviceType ?? DeviceType.UNKNOWN,
    isDesktop: data.isDesktop ?? false,
    isMobile: data.isMobile ?? false,
    isTablet: data.isTablet ?? false,
    platform: data.platform ?? {
      type: 'unknown',
      os: { name: 'unknown', version: 'unknown' },
      browser: { name: 'unknown', version: 'unknown' },
    },
    userAgent: data.userAgent ?? 'unknown',
    language: data.language ?? 'en',
    timeZone: data.timeZone ?? 'UTC',
    screen: data.screen ?? { width: 0, height: 0, pixelRatio: 1, path: '/' }, // Ensure path is included
    network: data.network ?? { type: 'unknown', effectiveType: 'unknown', downlink: 0, rtt: 0 },
    performance: data.performance ?? {
      navigation: null,
      webVitals: { lcp: null, fid: null, cls: null, navigationTiming: null, resourceTiming: [] },
      resources: [],
    },
    privacy: data.privacy ?? { doNotTrack: false, gdprCompliant: false },
    geolocation: data.geolocation ?? { latitude: null, longitude: null, accuracy: null },
    browserLanguage: data.browserLanguage ?? 'en',
    browserLocale: data.browserLocale ?? 'en-US',
    timeZoneOffset: data.timeZoneOffset ?? 0,
    lastIp: data.lastIp ?? '',
  };
}
