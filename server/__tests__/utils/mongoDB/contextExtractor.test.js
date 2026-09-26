/**
 * Unit Tests for MongoDB GTD Context Extractor
 * 
 * Tests cover:
 * 1. Filter normalization (year_start/year_end to $expr)
 * 2. City value sanitization (toLowerCase safety)
 * 3. needs_geo_data detection
 * 4. Query parsing edge cases
 * 5. Fallback mechanism
 */

// Mock mongoose before requiring modules
jest.mock('mongoose', () => ({
  connection: {
    db: {
      collection: jest.fn(() => ({
        distinct: jest.fn(),
        countDocuments: jest.fn(),
        find: jest.fn(() => ({
          limit: jest.fn(() => ({
            toArray: jest.fn(() => [])
          }))
        }))
      }))
    },
    readyState: 1
  }
}));

// Mock Attack model
jest.mock('../../../utils/mongoDB/models/Attack', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));

// Mock attack service
jest.mock('../../../utils/mongoDB/services/attackService', () => ({
  executeFilter: jest.fn(),
  searchAttacks: jest.fn()
}));

describe('MongoDBContextExtractor', () => {
  let contextExtractor;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-require to get fresh instance
    jest.resetModules();
    contextExtractor = require('../../../utils/mongoDB/contextExtractor');

    // Mock the cache loading
    contextExtractor.cacheLoaded = true;
    contextExtractor.knownCountries = ['Pakistan', 'Iraq'];
    contextExtractor.knownProvinces = ['Punjab', 'Sindh'];
    contextExtractor.knownGroups = ['Taliban'];
    contextExtractor.loadLocationCache = jest.fn().mockResolvedValue();
  });

  describe('normalizeGTDFilter', () => {
    test('should convert year_start to native iyear $gte condition', () => {
      const input = { country_txt: 'Iraq', year_start: 2010 };
      const result = contextExtractor.normalizeGTDFilter(input);

      expect(result).toHaveProperty('iyear');
      expect(result.iyear).toEqual({ $gte: 2010 });
      expect(result.country_txt).toBeDefined();
      // Should not contain year_start in output
      expect(result.year_start).toBeUndefined();
    });

    test('should convert year_end to native iyear $lte condition', () => {
      const input = { country_txt: 'Pakistan', year_end: 2017 };
      const result = contextExtractor.normalizeGTDFilter(input);

      expect(result).toHaveProperty('iyear');
      expect(result.iyear).toEqual({ $lte: 2017 });
    });

    test('should handle year_start and year_end together', () => {
      const input = { country_txt: 'Afghanistan', year_start: 2010, year_end: 2015 };
      const result = contextExtractor.normalizeGTDFilter(input);

      expect(result).toHaveProperty('iyear');
      expect(result.iyear).toEqual({ $gte: 2010, $lte: 2015 });
    });

    test('should pass through other fields unchanged', () => {
      const input = { country_txt: 'Iraq', city: 'Baghdad', attacktype1_txt: 'Bombing' };
      const result = contextExtractor.normalizeGTDFilter(input);

      expect(result.country_txt).toEqual(expect.objectContaining({
        $regex: expect.stringMatching(/Iraq/i),
        $options: 'i'
      }));
      expect(result.city).toEqual(expect.objectContaining({
        $regex: expect.stringMatching(/Baghdad/i),
        $options: 'i'
      }));
      expect(result.attacktype1_txt).toEqual('Bombing');
    });

    test('should handle empty filter', () => {
      const result = contextExtractor.normalizeGTDFilter({});
      expect(result).toEqual({});
    });

    test('should handle null/undefined filter', () => {
      expect(contextExtractor.normalizeGTDFilter(null)).toBe(null);
      expect(contextExtractor.normalizeGTDFilter(undefined)).toBe(undefined);
    });
  });

  describe('toCompassFilter', () => {
    test('should generate Compass-compatible filter string', () => {
      const filter = { country_txt: 'Iraq', year_start: 2010, year_end: 2017 };
      const result = contextExtractor.toCompassFilter(filter);

      expect(typeof result).toBe('string');
      expect(result).toContain('$expr');
      expect(result).toContain('$convert');
    });
  });

  describe('needsGeoData', () => {
    test('should return true for map-related queries', () => {
      expect(contextExtractor.needsGeoData('show attacks on a map')).toBe(true);
      expect(contextExtractor.needsGeoData('create a heatmap of terrorism')).toBe(true);
      expect(contextExtractor.needsGeoData('visualize attacks in Iraq')).toBe(true);
    });

    test('should return true for location-based queries', () => {
      expect(contextExtractor.needsGeoData('where did attacks occur in Pakistan')).toBe(true);
      expect(contextExtractor.needsGeoData('plot the locations of bombings')).toBe(true);
    });

    test('should return false for non-geo queries', () => {
      expect(contextExtractor.needsGeoData('how many attacks in Iraq')).toBe(false);
      expect(contextExtractor.needsGeoData('list terrorist groups')).toBe(false);
      expect(contextExtractor.needsGeoData('statistics on terrorism')).toBe(false);
    });

    test('should handle empty/null queries', () => {
      expect(contextExtractor.needsGeoData('')).toBe(false);
      expect(contextExtractor.needsGeoData(null)).toBe(false);
      expect(contextExtractor.needsGeoData(undefined)).toBe(false);
    });
  });

  describe('escapeRegex', () => {
    test('should escape special regex characters', () => {
      const input = 'Al-Qaeda (AQ)';
      const result = contextExtractor.escapeRegex(input);

      expect(result).toContain('\\(');
      expect(result).toContain('\\)');
    });

    test('should handle null/undefined', () => {
      expect(contextExtractor.escapeRegex(null)).toBe(null);
      expect(contextExtractor.escapeRegex(undefined)).toBe(undefined);
    });

    test('should handle non-string input', () => {
      expect(contextExtractor.escapeRegex(123)).toBe(123);
    });
  });

  describe('isFollowUpQuery', () => {
    test('should detect follow-up patterns', () => {
      expect(contextExtractor.isFollowUpQuery('list 5 of the attacks')).toBe(true);
      expect(contextExtractor.isFollowUpQuery('give me details about those attacks')).toBe(true);
      expect(contextExtractor.isFollowUpQuery('show me more details')).toBe(true);
    });

    test('should not flag new queries', () => {
      expect(contextExtractor.isFollowUpQuery('attacks in Iraq in 2015')).toBe(false);
      expect(contextExtractor.isFollowUpQuery('terrorism statistics for Pakistan')).toBe(false);
    });
  });

  describe('buildMongoDBFilter', () => {
    test('should build filter for country', () => {
      const conditions = { country_txt: 'Iraq' };
      const filter = contextExtractor.buildMongoDBFilter(conditions);

      expect(filter).toHaveProperty('country_txt');
    });

    test('should build filter for year range with native iyear range', () => {
      const conditions = { _yearRange: { start: 2010, end: 2015 } };
      const filter = contextExtractor.buildMongoDBFilter(conditions);

      expect(filter).toHaveProperty('iyear');
      expect(filter.iyear).toEqual({ $gte: 2010, $lte: 2015 });
    });

    test('should build filter for attack type', () => {
      const conditions = { attacktype1_txt: 'Bombing/Explosion' };
      const filter = contextExtractor.buildMongoDBFilter(conditions);

      expect(filter).toHaveProperty('attacktype1_txt');
    });
  });

  describe('parseQuery edge cases', () => {
    test('should match plural attack type "bombings" as Bombing/Explosion', async () => {
      const result = await contextExtractor.parseNaturalLanguageQuery('Deadliest Bombings in Iraq?');

      expect(result.country_txt).toBe('Iraq');
      expect(result.attacktype1_txt).toBe('Bombing/Explosion');
      expect(result.gname).toBeUndefined();
    });

    test('should not extract generic "group" as a terrorist group name', async () => {
      const result = await contextExtractor.parseNaturalLanguageQuery('Deadliest Bombings in Iraq Show deadliest bombings in Iraq by group');

      expect(result.country_txt).toBe('Iraq');
      expect(result.attacktype1_txt).toBe('Bombing/Explosion');
      expect(result.gname).toBeUndefined();
      expect(result._potentialGroup).toBeUndefined();
    });

    test('lookupGroupInDatabase should return null for generic word "group"', async () => {
      const result = await contextExtractor.lookupGroupInDatabase('group');
      expect(result).toBeNull();
    });

    test('GTDNormalizer should normalize plural "bombings" to "Bombing/Explosion"', () => {
      const normalizer = require('../../../utils/mongoDB/GTDNormalizationService');
      const normalized = normalizer.normalizeFilter({ attacktype1_txt: 'bombings' });
      expect(normalized.attacktype1_txt).toBe('Bombing/Explosion');
    });

    test('should extract region South Asia and NOT extract South as province', async () => {
      // Add 'South' to known provinces mock to simulate the edge case
      contextExtractor.knownProvinces = ['Punjab', 'Sindh', 'South'];
      const result = await contextExtractor.parseNaturalLanguageQuery(
        'South Asia Incident Analysis Analyze trends in terrorist incidents across South Asia'
      );

      expect(result.region_txt).toBe('South Asia');
      expect(result.provstate).toBeUndefined();
      expect(result._isStatistical).toBe(true);
    });
  });
});

describe('GTD Config', () => {
  let gtdConfig;

  beforeEach(() => {
    // Clear environment variables
    delete process.env.GTD_LLM_MAX_TOKENS;
    delete process.env.GTD_LLM_TIMEOUT_MS;
    delete process.env.GTD_ENABLE_FALLBACK;
    delete process.env.GTD_MAX_RECORDS;

    jest.resetModules();
    gtdConfig = require('../../../utils/mongoDB/gtdConfig');
  });

  test('should return default maxTokens of 4096', () => {
    expect(gtdConfig.maxTokens).toBe(4096);
  });

  test('should respect GTD_LLM_MAX_TOKENS env variable', () => {
    process.env.GTD_LLM_MAX_TOKENS = '8192';
    jest.resetModules();
    gtdConfig = require('../../../utils/mongoDB/gtdConfig');
    expect(gtdConfig.maxTokens).toBe(8192);
  });

  test('should cap maxTokens at 32768', () => {
    process.env.GTD_LLM_MAX_TOKENS = '100000';
    jest.resetModules();
    gtdConfig = require('../../../utils/mongoDB/gtdConfig');
    expect(gtdConfig.maxTokens).toBe(32768);
  });

  test('should return default timeoutMs of 30000', () => {
    expect(gtdConfig.timeoutMs).toBe(30000);
  });

  test('should return default enableFallback as true', () => {
    expect(gtdConfig.enableFallback).toBe(true);
  });

  test('should disable fallback when GTD_ENABLE_FALLBACK=false', () => {
    process.env.GTD_ENABLE_FALLBACK = 'false';
    jest.resetModules();
    gtdConfig = require('../../../utils/mongoDB/gtdConfig');
    expect(gtdConfig.enableFallback).toBe(false);
  });

  test('should return safe tokens for different models', () => {
    expect(gtdConfig.getMaxTokensForModel('gpt-4-turbo')).toBeLessThanOrEqual(8192);
    expect(gtdConfig.getMaxTokensForModel('claude-3-opus')).toBeLessThanOrEqual(4096);
    expect(gtdConfig.getMaxTokensForModel('gemini-pro')).toBeLessThanOrEqual(8192);
  });
});
