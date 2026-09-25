const { ResponseProxy } = require('../../../utils/chats/ResponseProxy');
const { extractJsonFromLLMResponse } = require('../../../utils/chats/jsonUtils');
const EventEmitter = require('events');

describe('ResponseProxy', () => {
  let mockResponse;
  let writtenChunks;

  beforeEach(() => {
    writtenChunks = [];
    mockResponse = new EventEmitter();
    mockResponse.write = jest.fn((chunk) => {
      writtenChunks.push(chunk);
      return true;
    });
  });

  test('should strip internal JSON with standard quotes', () => {
    const proxy = new ResponseProxy(mockResponse);
    const input = 'There were 10 attacks.\n\n{"answer": "There were 10 attacks.", "confidence": 1.0, "query_type": "statistical"}';
    const output = proxy.processToken(input);
    expect(output.trim()).toBe('There were 10 attacks.');
  });

  test('should strip internal JSON with smart/curly quotes', () => {
    const proxy = new ResponseProxy(mockResponse);
    const input = 'There were 25,011 attacks in South Asia.\n{“answer”:“There were 25,011 attacks in South Asia.”,“confidence”:1.0,“query_type”:“statistical”}';
    const output = proxy.processToken(input);
    expect(output.trim()).toBe('There were 25,011 attacks in South Asia.');
  });

  test('should preserve normal text containing curly braces that are not target JSON', () => {
    const proxy = new ResponseProxy(mockResponse);
    const input = 'Here is an object: { "foo": "bar" } and some text.';
    const output = proxy.processToken(input);
    expect(output).toContain('{ "foo": "bar" }');
  });

  test('should hide streaming tokens incrementally across multiple chunks', () => {
    const proxy = new ResponseProxy(mockResponse);
    const chunk1 = 'According to GTD, 5 attacks happened. ';
    const chunk2 = '{"ans';
    const chunk3 = 'wer": "According to GTD, 5 attacks happened.", "mongo_';
    const chunk4 = 'filter": {"country_txt": "Iraq"}}';
    const chunk5 = 'More text';

    const out1 = proxy.processToken(chunk1);
    const out2 = proxy.processToken(chunk2);
    const out3 = proxy.processToken(chunk3);
    const out4 = proxy.processToken(chunk4);
    const out5 = proxy.processToken(chunk5);

    const fullOutput = (out1 + out2 + out3 + out4 + out5).trim();
    expect(fullOutput).toBe('According to GTD, 5 attacks happened. More text');
  });
});

describe('jsonUtils - extractJsonFromLLMResponse', () => {
  test('should extract standard JSON from LLM response text', () => {
    const text = 'Here is the response.\n\n{"answer": "Here is the response.", "confidence": 1.0, "query_type": "statistical", "mongo_filter": {"country_txt": "Iraq"}}';
    const result = extractJsonFromLLMResponse(text);
    expect(result).not.toBeNull();
    expect(result.parsed.answer).toBe('Here is the response.');
    expect(result.parsed.mongo_filter.country_txt).toBe('Iraq');
  });

  test('should extract and parse JSON with smart/curly quotes', () => {
    const text = 'Summary text.\n{“answer”:“Summary text.”,“confidence”:1.0,“query_type”:“statistical”,“mongo_filter”:{“country_txt”:“Iraq”}}';
    const result = extractJsonFromLLMResponse(text);
    expect(result).not.toBeNull();
    expect(result.parsed.answer).toBe('Summary text.');
    expect(result.parsed.mongo_filter.country_txt).toBe('Iraq');
  });

  test('should handle empty or null input gracefully', () => {
    expect(extractJsonFromLLMResponse('')).toBeNull();
    expect(extractJsonFromLLMResponse(null)).toBeNull();
    expect(extractJsonFromLLMResponse(undefined)).toBeNull();
  });
});
