import { z } from 'zod';
import { Timestamp } from './dateUtils';
import { DeviceType, NetworkType } from '../types/baseTypes';
import { 
  BasePerformanceEntrySchema, 
  BaseResourceTimingSchema,
  DeviceInfo,
  toTimestamp 
} from '../types/commonTypes';

// Basic timing schemas
const CommonBaseNavigationTimingSchema = z.object({
  type: z.string(),
  startTime: z.number(),
  duration: z.number(),
}).strict();

const ServerTimingSchema = z.object({
  name: z.string(),
  duration: z.number(),
  description: z.string(),
  toJSON: z.function().optional(),
}).strict();

// Network and IP related schemas
export const IpInfoSchema = z.object({
  hasError: z.boolean(),
  ip: z.string(),
  hostname: z.string(),
  city: z.string(),
  region: z.string(),
  country: z.string(),
  loc: z.string(),
  org: z.string(),
  postal: z.string(),
  timezone: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
}).strict();

// Performance related schemas
export const _MutablePerformanceResourceTimingSchema = z.object({
  entryType: z.string(),
  startTime: z.number(),
  name: z.string(),
  duration: z.number(),
  connectStart: z.number(),
  connectEnd: z.number(),
  decodedBodySize: z.number(),
  domainLookupStart: z.number(),
  domainLookupEnd: z.number(),
  encodedBodySize: z.number(),
  redirectStart: z.number(),
  redirectEnd: z.number(),
  fetchStart: z.number(),
  responseStart: z.number(),
  responseEnd: z.number(),
  secureConnectionStart: z.number(),
  initiatorType: z.string(),
  nextHopProtocol: z.string(),
  requestStart: z.number(),
  responseStatus: z.number().optional(),
  transferSize: z.number(),
  workerStart: z.number(),
  toJSON: z.function().returns(z.unknown()).optional(),
  serverTiming: z.array(ServerTimingSchema).optional(),
  renderBlockingStatus: z.enum(['blocking', 'non-blocking']).optional(),
}).strict();

// Core environment data schema
export const _RawEnvironmentDataSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().min(1),
  deviceType: z.nativeEnum(DeviceType),
  platform: z.object({ 
    type: z.string().min(1), 
    os: z.object({ 
      name: z.string().min(1), 
      version: z.string().min(1) 
    }).strict(), 
    browser: z.object({ 
      name: z.string().min(1), 
      version: z.string().min(1) 
    }).strict() 
  }).strict(),
  userAgent: z.string().min(1),
  language: z.string().min(2),
  timeZone: z.string().min(1),
  isDesktop: z.boolean(),
  isMobile: z.boolean(),
  isTablet: z.boolean(),
  screen: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    pixelRatio: z.number().positive(),
    path: z.string(),
  }).strict(),
  network: z.object({
    type: z.custom<NetworkType>((val): val is NetworkType => 
      ['slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'ethernet', 'unknown'].includes(val as string)
    ),
    effectiveType: z.custom<NetworkType>((val): val is NetworkType => 
      ['slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'ethernet', 'unknown'].includes(val as string)
    ),
    downlink: z.number().nonnegative(),
    rtt: z.number().nonnegative(),
  }).strict(),
  performance: z.object({
    navigation: CommonBaseNavigationTimingSchema.nullable(),
    webVitals: z.object({
      lcp: z.number().nullable(),
      fid: z.number().nullable(),
      cls: z.number().nullable(),
      navigationTiming: BasePerformanceEntrySchema.passthrough().nullable(),
      resourceTiming: z.array(BaseResourceTimingSchema),
    }).strict(),
    resources: z.array(_MutablePerformanceResourceTimingSchema),
  }).strict(),
  privacy: z.object({
    doNotTrack: z.boolean(),
    gdprCompliant: z.boolean(),
  }).strict(),
  geolocation: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    accuracy: z.number().nullable(),
  }).optional(),
  browserLanguage: z.string().min(2),
  browserLocale: z.string().min(2),
  timeZoneOffset: z.number(),
  lastActivityTime: z.union([
    z.number(),
    z.custom<Timestamp>((val): val is Timestamp => typeof val === 'number')
  ]),
  lastIp: z.string().min(1),
}).strict().transform((data) => ({
  ...data,
  privacy: data.privacy ?? { doNotTrack: false, gdprCompliant: false },
  lastActivityTime: toTimestamp(data.lastActivityTime),
}));

// Export the inferred type for the raw data
export type RawEnvironmentData = z.infer<typeof _RawEnvironmentDataSchema>;

// Mapping function for converting raw environment data to DeviceInfo
export function mapEnvironmentToDeviceInfo(envData: RawEnvironmentData): DeviceInfo {
  return {
    lastActivityTime: envData.lastActivityTime,
    id: envData.id,
    deviceId: envData.deviceId,
    deviceType: envData.deviceType,
    isDesktop: envData.isDesktop,
    isMobile: envData.isMobile,
    isTablet: envData.isTablet,
    platform: envData.platform,
    userAgent: envData.userAgent,
    language: envData.language,
    timeZone: envData.timeZone,
    screen: envData.screen,
    network: {
      type: envData.network.type,
      effectiveType: envData.network.effectiveType,
      downlink: envData.network.downlink,
      rtt: envData.network.rtt,
    },
    performance: {
      navigation: envData.performance?.navigation ?? null,
      webVitals: {
        lcp: envData.performance?.webVitals?.lcp ?? null,
        fid: envData.performance?.webVitals?.fid ?? null,
        cls: envData.performance?.webVitals?.cls ?? null,
        navigationTiming: envData.performance?.webVitals?.navigationTiming ?? null,
        resourceTiming: envData.performance?.webVitals?.resourceTiming ?? [],
      },
      resources: envData.performance?.resources ?? [],
    },
    privacy: envData.privacy,
    geolocation: envData.geolocation || undefined,
    browserLanguage: envData.browserLanguage,
    browserLocale: envData.browserLocale,
    timeZoneOffset: envData.timeZoneOffset,
    lastIp: envData.lastIp,
  };
}
