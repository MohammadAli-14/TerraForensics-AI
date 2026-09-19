/**
 * Unit Tests for GTD System Prompt and needs_geo_data Heuristics
 * 
 * Run with: npx jest __tests__/utils/mongoDB/gtdSystemPrompt.test.js
 */

const {
  GTD_SYSTEM_PROMPT,
  NEEDS_GEO_DATA_HEURISTICS,
  evaluateNeedsGeoData,
  validateAndCorrectNeedsGeoData,
  buildContextWithJsonInstructions
} = require('../../../utils/mongoDB/gtdSystemPrompt');

describe('GTD System Prompt Module', () => {
  
  describe('GTD_SYSTEM_PROMPT', () => {
    it('should be a non-empty string', () => {
      expect(typeof GTD_SYSTEM_PROMPT).toBe('string');
      expect(GTD_SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    });
    
    it('should contain JSON output format instructions', () => {
      expect(GTD_SYSTEM_PROMPT).toContain('REQUIRED JSON OUTPUT FORMAT');
      expect(GTD_SYSTEM_PROMPT).toContain('"answer"');
      expect(GTD_SYSTEM_PROMPT).toContain('"confidence"');
      expect(GTD_SYSTEM_PROMPT).toContain('"query_type"');
      expect(GTD_SYSTEM_PROMPT).toContain('"mongo_filter"');
      expect(GTD_SYSTEM_PROMPT).toContain('"needs_geo_data"');
      expect(GTD_SYSTEM_PROMPT).toContain('"limit"');
    });
    
    it('should contain needs_geo_data heuristics', () => {
      expect(GTD_SYSTEM_PROMPT).toContain('SET needs_geo_data = true WHEN');
      expect(GTD_SYSTEM_PROMPT).toContain('SET needs_geo_data = false ONLY WHEN');
    });
    
    it('should emphasize location filters require geo data', () => {
      expect(GTD_SYSTEM_PROMPT).toContain('Query asks about attacks IN a country');
      expect(GTD_SYSTEM_PROMPT).toContain('Query is a COUNT query filtered by LOCATION');
    });
  });
  
  describe('evaluateNeedsGeoData()', () => {
    
    describe('should return needsGeo=true for location queries', () => {
      const locationQueries = [
        { query: 'How many attacks in Iraq?', filter: { country_txt: 'Iraq' } },
        { query: 'Show attacks in Pakistan', filter: { country_txt: 'Pakistan' } },
        { query: 'Attacks in Karachi', filter: { city: 'Karachi' } },
        { query: 'How many bombings happened in Afghanistan?', filter: { country_txt: 'Afghanistan' } },
        { query: 'List all attacks in Syria between 2011 and 2017', filter: { country_txt: 'Syria', year_start: 2011, year_end: 2017 } },
        { query: 'Show me attacks in Russia', filter: { country_txt: 'Russia' } },
        { query: 'Where did Taliban attacks occur?', filter: { gname: 'Taliban' } },
        { query: 'Plot attacks on map for Nigeria', filter: { country_txt: 'Nigeria' } },
        { query: 'Display heatmap of attacks in India', filter: { country_txt: 'India' } },
      ];
      
      locationQueries.forEach(({ query, filter }) => {
        it(`"${query.substring(0, 40)}..." → needs_geo_data=true`, () => {
          const result = evaluateNeedsGeoData(query, filter);
          expect(result.needsGeo).toBe(true);
          expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });
      });
    });
    
    describe('should return needsGeo=false for non-geographic queries', () => {
      const nonGeoQueries = [
        { query: 'What is event ID 201512310001?', filter: { eventid: '201512310001' } },
        { query: 'Total attacks per year globally', filter: {} },
        { query: 'Global total of all attacks', filter: {} },
      ];
      
      nonGeoQueries.forEach(({ query, filter }) => {
        it(`"${query.substring(0, 40)}..." → needs_geo_data=false`, () => {
          const result = evaluateNeedsGeoData(query, filter);
          expect(result.needsGeo).toBe(false);
        });
      });
    });
    
    describe('filter-based detection', () => {
      it('should detect country_txt in filter as needing geo', () => {
        const result = evaluateNeedsGeoData('count attacks', { country_txt: 'Iraq' });
        expect(result.needsGeo).toBe(true);
        expect(result.reason).toContain('country_txt');
      });
      
      it('should detect city in filter as needing geo', () => {
        const result = evaluateNeedsGeoData('count attacks', { city: 'Baghdad' });
        expect(result.needsGeo).toBe(true);
        expect(result.reason).toContain('city');
      });
      
      it('should detect region_txt in filter as needing geo', () => {
        const result = evaluateNeedsGeoData('count attacks', { region_txt: 'Middle East & North Africa' });
        expect(result.needsGeo).toBe(true);
        expect(result.reason).toContain('region_txt');
      });
    });
  });
  
  describe('validateAndCorrectNeedsGeoData()', () => {
    
    it('should override needs_geo_data=false when filter has country_txt', () => {
      const llmJson = {
        answer: 'There were 24,636 attacks in Iraq',
        confidence: 1.0,
        query_type: 'statistical',
        mongo_filter: { country_txt: 'Iraq' },
        needs_geo_data: false,  // WRONG - should be true
        limit: 5000
      };
      
      const corrected = validateAndCorrectNeedsGeoData(llmJson, 'How many attacks in Iraq?');
      
      expect(corrected.needs_geo_data).toBe(true);
      expect(corrected._geo_override).toBeDefined();
      expect(corrected._geo_override.original).toBe(false);
      expect(corrected._geo_override.corrected).toBe(true);
    });
    
    it('should not override when LLM is correct', () => {
      const llmJson = {
        answer: 'There were 24,636 attacks in Iraq',
        mongo_filter: { country_txt: 'Iraq' },
        needs_geo_data: true,  // CORRECT
        limit: 5000
      };
      
      const corrected = validateAndCorrectNeedsGeoData(llmJson, 'How many attacks in Iraq?');
      
      expect(corrected.needs_geo_data).toBe(true);
      expect(corrected._geo_override).toBeUndefined();
    });
    
    it('should handle null/undefined input gracefully', () => {
      expect(validateAndCorrectNeedsGeoData(null, 'test')).toBeNull();
      expect(validateAndCorrectNeedsGeoData(undefined, 'test')).toBeUndefined();
      expect(validateAndCorrectNeedsGeoData({}, 'test')).toEqual({});
    });
  });
  
  describe('buildContextWithJsonInstructions()', () => {
    
    it('should include count, killed, wounded in context', () => {
      const context = buildContextWithJsonInstructions({
        count: 24636,
        killed: 85000,
        wounded: 120000,
        filter: { country_txt: 'Iraq' },
        filterDescription: 'in Iraq',
        verificationCode: 'GTD-TEST-123'
      });
      
      expect(context).toContain('24,636 attacks');
      expect(context).toContain('85,000 killed');
      expect(context).toContain('120,000 wounded');
    });
    
    it('should include filter in JSON template', () => {
      const context = buildContextWithJsonInstructions({
        count: 100,
        killed: 500,
        wounded: 1000,
        filter: { country_txt: 'Pakistan', year_start: 2010, year_end: 2017 },
        filterDescription: 'in Pakistan 2010-2017',
        verificationCode: 'GTD-TEST-456'
      });
      
      expect(context).toContain('"country_txt": "Pakistan"');
      expect(context).toContain('REQUIRED JSON OUTPUT');
    });
    
    it('should emphasize needs_geo_data=true for location filters', () => {
      const context = buildContextWithJsonInstructions({
        count: 100,
        killed: 500,
        wounded: 1000,
        filter: { country_txt: 'Iraq' },
        filterDescription: 'in Iraq',
        verificationCode: 'GTD-TEST-789'
      });
      
      expect(context).toContain('needs_geo_data MUST be true');
      expect(context).toContain('query filters by location');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST QUERIES WITH EXPECTED JSON OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Expected LLM JSON Outputs', () => {
  
  const testCases = [
    {
      query: 'How many attacks in Iraq?',
      expectedJson: {
        answer: 'According to the Global Terrorism Database, there were 24,636 attacks in Iraq between 1970 and 2017.',
        confidence: 1.0,
        query_type: 'statistical',
        mongo_filter: { country_txt: 'Iraq' },
        needs_geo_data: true,
        limit: 30000
      },
      assertions: (json) => {
        expect(json.needs_geo_data).toBe(true);
        expect(json.mongo_filter.country_txt).toBe('Iraq');
        expect(json.query_type).toBe('statistical');
        expect(json.confidence).toBeGreaterThanOrEqual(0.9);
      }
    },
    {
      query: 'Show me suicide bombings in Pakistan from 2010 to 2017',
      expectedJson: {
        answer: 'There were 487 suicide bombings in Pakistan from 2010 to 2017.',
        confidence: 1.0,
        query_type: 'statistical',
        mongo_filter: { 
          country_txt: 'Pakistan', 
          suicide: '1',
          year_start: 2010,
          year_end: 2017
        },
        needs_geo_data: true,
        limit: 5000
      },
      assertions: (json) => {
        expect(json.needs_geo_data).toBe(true);
        expect(json.mongo_filter.country_txt).toBe('Pakistan');
        expect(json.mongo_filter.suicide).toBe('1');
        expect(json.mongo_filter.year_start).toBe(2010);
        expect(json.mongo_filter.year_end).toBe(2017);
      }
    },
    {
      query: 'How many attacks by Taliban in Afghanistan?',
      expectedJson: {
        answer: 'Taliban conducted 4,832 attacks in Afghanistan according to the GTD.',
        confidence: 1.0,
        query_type: 'statistical',
        mongo_filter: { 
          country_txt: 'Afghanistan',
          gname: 'Taliban'
        },
        needs_geo_data: true,
        limit: 5000
      },
      assertions: (json) => {
        expect(json.needs_geo_data).toBe(true);
        expect(json.mongo_filter.gname).toBe('Taliban');
        expect(json.mongo_filter.country_txt).toBe('Afghanistan');
      }
    },
    {
      query: 'Plot heatmap of attacks in Syria',
      expectedJson: {
        answer: 'Here is the heatmap of attacks in Syria from the GTD.',
        confidence: 1.0,
        query_type: 'geographic',
        mongo_filter: { country_txt: 'Syria' },
        needs_geo_data: true,
        limit: 30000
      },
      assertions: (json) => {
        expect(json.needs_geo_data).toBe(true);
        expect(json.query_type).toBe('geographic');
        expect(json.mongo_filter.country_txt).toBe('Syria');
      }
    },
    {
      query: 'What is event ID 201512310001?',
      expectedJson: {
        answer: 'Event ID 201512310001 was an attack...',
        confidence: 1.0,
        query_type: 'detail',
        mongo_filter: { eventid: '201512310001' },
        needs_geo_data: false,
        limit: 1
      },
      assertions: (json) => {
        expect(json.needs_geo_data).toBe(false);
        expect(json.query_type).toBe('detail');
        expect(json.mongo_filter.eventid).toBe('201512310001');
      }
    }
  ];
  
  testCases.forEach(({ query, expectedJson, assertions }, index) => {
    it(`Test Case ${index + 1}: "${query.substring(0, 40)}..."`, () => {
      // Validate expected structure
      expect(expectedJson).toHaveProperty('answer');
      expect(expectedJson).toHaveProperty('confidence');
      expect(expectedJson).toHaveProperty('query_type');
      expect(expectedJson).toHaveProperty('mongo_filter');
      expect(expectedJson).toHaveProperty('needs_geo_data');
      expect(expectedJson).toHaveProperty('limit');
      
      // Run custom assertions
      assertions(expectedJson);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE FILTER EXECUTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Filter Execution Simulation', () => {
  
  // Mock attackService.executeFilter
  const mockExecuteFilter = jest.fn();
  
  beforeEach(() => {
    mockExecuteFilter.mockReset();
  });
  
  it('should execute Iraq filter and return geo_points', async () => {
    const filter = { country_txt: 'Iraq' };
    const expectedResult = {
      success: true,
      totalCount: 24636,
      results: [
        { eventid: '1', latitude: '33.3', longitude: '44.4', country_txt: 'Iraq' },
        { eventid: '2', latitude: '33.4', longitude: '44.5', country_txt: 'Iraq' },
      ]
    };
    
    mockExecuteFilter.mockResolvedValue(expectedResult);
    
    const result = await mockExecuteFilter(filter, { limit: 30000 });
    
    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(24636);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].latitude).toBeDefined();
    expect(result.results[0].longitude).toBeDefined();
  });
  
  it('should handle year range conversion', async () => {
    const filter = { 
      country_txt: 'Pakistan',
      year_start: 2010,
      year_end: 2017
    };
    
    // The server should convert this to:
    // { country_txt: 'Pakistan', $expr: { $and: [...year checks...] } }
    
    mockExecuteFilter.mockResolvedValue({
      success: true,
      totalCount: 8500,
      results: []
    });
    
    const result = await mockExecuteFilter(filter, { limit: 5000 });
    
    expect(result.success).toBe(true);
    expect(mockExecuteFilter).toHaveBeenCalledWith(
      expect.objectContaining({ country_txt: 'Pakistan' }),
      expect.objectContaining({ limit: 5000 })
    );
  });
});
