import { EntityId as ReduxEntityId } from '@reduxjs/toolkit';


export type EntityId = ReduxEntityId;

export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  GRAPHQL_ERROR = 'GRAPHQL_ERROR',
  PARSING_ERROR = 'PARSING_ERROR',
  GLOBAL_ERROR = 'GLOBAL_ERROR',
  API_ERROR = 'API_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  SUBSCRIPTION_ERROR = 'SUBSCRIPTION_ERROR',
  SUBSCRIPTION_SETUP_ERROR = 'SUBSCRIPTION_SETUP_ERROR',
  OPTIMISTIC_UPDATE_FAILED = 'OPTIMISTIC_UPDATE_FAILED',
  OPERATION_FAILED = 'OPERATION_FAILED',
  SECURITY_QUERY_ERROR = 'SECURITY_QUERY_ERROR',
  SECURITY_PASSWORD_CHANGE_ERROR = 'SECURITY_PASSWORD_CHANGE_ERROR',
  SECURITY_PASSWORD_RESET_ERROR = 'SECURITY_PASSWORD_RESET_ERROR',
  SECURITY_PASSWORD_FORGOT_ERROR = 'SECURITY_PASSWORD_FORGOT_ERROR',
  SECURITY_RECOVERY_INIT_ERROR = 'SECURITY_RECOVERY_INIT_ERROR',
  SECURITY_RECOVERY_VERIFY_ERROR = 'SECURITY_RECOVERY_VERIFY_ERROR',
  SECURITY_RATE_LIMIT_ERROR = 'SECURITY_RATE_LIMIT_ERROR',
  WS_LINK_ERROR = 'WS_LINK_ERROR',
  CACHE_INIT_ERROR = 'CACHE_INIT_ERROR',
  CACHE_ERROR = "CACHE_ERROR",
}

export enum Severity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}




export interface CustomError extends Omit<Partial<CacheableEntity>, 'id'> {// Uses Severity, Timestamp from baseTypes
  type: 'ValidationError' | 'AuthenticationError' | 'AuthorizationError' | 'ServerError' | 'NetworkError' | 'UnknownError';
  status: ErrorType;
  name?: string;
  code?: string;
  message: string;
  severity: Severity;
  timestamp: Timestamp;
  entityType?: string; // Add optional entityType property
  retryPolicy?: {
    retryable: boolean;
    retryCount: number;
    maxRetries: number;
    retryDelay?: (attempt: number) => number;
  };
  stack?: string;
  userMessage?: string;
  entityId?: EntityId;
  graphQLErrors?: MutableGraphQLFormattedError[];
  networkError?: Error | null;
  operation?: OperationWrapper;
  details?: Record<string, unknown>;
  metadata?: {
    component?: string;
    action?: string;
    userId?: EntityId;
    path?: EntityId;
    operation?: string;
    validationFields?: Record<string, string>;
    contextData?: Record<string, unknown>;
    originalError?: Error;
    originalPayload?: unknown;
    actionType?: string;
    payloadSample?: unknown;
    transactionId?: string;
  };
  originalError?: Error;
}

// MutablePerformanceResourceTiming (needed by DeviceInfo)
export interface MutablePerformanceResourceTiming {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  initiatorType?: string;
  nextHopProtocol?: string;
  renderBlockingStatus?: string;
  workerStart?: number;
  redirectStart?: number;
  redirectEnd?: number;
  fetchStart?: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  secureConnectionStart?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
}

// DeviceInfo - Keep here, complex type, uses Timestamp, DeviceType, NetworkType, MutablePerformanceResourceTiming, Zod schemas?
export interface DeviceInfo {
  lastActivityTime: Timestamp;
  id: string;
  deviceId: string;
  deviceType: DeviceType;
  isDesktop: boolean;
  isMobile: boolean;
  isTablet: boolean;
  platform: {
    type: string;
    os: {
      name: string;
      version: string;
    };
    browser: {
      name: string;
      version: string;
    };
  };
  userAgent: string;
  language: string;
  timeZone: string;
  screen: {
    width: number;
    height: number;
    pixelRatio: number;
    path: string;
  };
  network: NetworkInfo;
  performance?: {
    navigation: any | null;
    webVitals: {
      lcp: number | null;
      fid: number | null;
      cls: number | null;
      navigationTiming: any | null;
      resourceTiming: any[];
    };
    resources: MutablePerformanceResourceTiming[];
  };
  privacy: {
    doNotTrack: boolean;
    gdprCompliant: boolean;
  };
  geolocation?: {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
  };
  browserLanguage: string;
  browserLocale: string;
  timeZoneOffset: number;
  lastIp?: string;
}

export enum DeviceType {
  DESKTOP = 'desktop',
  MOBILE = 'mobile',
  TABLET = 'tablet',
  UNKNOWN = 'unknown',
}

export interface NetworkInfo {
  type: NetworkType;  // Uses NetworkType enum
  effectiveType: NetworkType;
  downlink: number;
  rtt: number;
}

type NetworkType = 'slow-2g' | '2g' | '3g' | '4g' | '5g' | 'wifi' | 'ethernet' | 'unknown'; 

/ Zod schemas (as discussed)
export const BasePerformanceEntrySchema = z
  .object({
    entryType: z.string(),
    startTime: z.number(),
    // Add other properties as per your BasePerformanceEntry interface
  })
  .strict(); // Add other fields based on actual PerformanceEntry

  //NavigationTiming

export const BaseResourceTimingSchema = z
  .object({
    name: z.string(),
    duration: z.number(),
    entryType: z.string(),
    startTime: z.number(),
    connectStart: z.number().optional(), // Make optional if needed
    connectEnd: z.number().optional(), // Make optional if needed
    // Add all other relevant PerformanceResourceTiming properties
  })
  .strict();
