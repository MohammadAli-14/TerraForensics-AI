const EventEmitter = require("events");
const { safeJSONStringify } = require("../helpers/chat/responses");

/**
 * A proxy for the Express Response object that strips internal JSON from the stream.
 * It intercepts tokens written to the stream, detects specific JSON patterns,
 * and hides them from the output while preserving the valid text response.
 */
class ResponseProxy extends EventEmitter {
  constructor(response) {
    super();
    this.originalResponse = response;
    this.buffer = "";
    this.isHiding = false;
    this.braceCount = 0;
    this.inString = false;
    this.isEscaping = false;

    // We look for these keys at the start of a JSON object to identify it as internal metadata
    this.targetKeys = [
      '"answer"',
      '"confidence"',
      '"query_type"',
      '"mongo_filter"',
      '"server_instructions"',
    ];

    // Bind all methods to this instance
    this.write = this.write.bind(this);
    this.end = this.end.bind(this);
    this.on = this.on.bind(this);
    this.once = this.once.bind(this);
    this.removeListener = this.removeListener.bind(this);

    // Forward events from original response
    this.originalResponse.on("close", () => this.emit("close"));
    this.originalResponse.on("drain", () => this.emit("drain"));
    this.originalResponse.on("error", (err) => this.emit("error", err));
    this.originalResponse.on("finish", () => this.emit("finish"));
  }

  // Forward event listener methods
  on(event, listener) {
    if (
      event === "close" ||
      event === "drain" ||
      event === "error" ||
      event === "finish"
    ) {
      this.originalResponse.on(event, listener);
    } else {
      super.on(event, listener);
    }
    return this;
  }

  once(event, listener) {
    if (
      event === "close" ||
      event === "drain" ||
      event === "error" ||
      event === "finish"
    ) {
      this.originalResponse.once(event, listener);
    } else {
      super.once(event, listener);
    }
    return this;
  }

  removeListener(event, listener) {
    this.originalResponse.removeListener(event, listener);
    return this;
  }

  /**
   * Process a text token and return the parts that should be shown to the user.
   * Maintains state to strip internal JSON blocks.
   */
  processToken(token) {
    if (!token) return "";
    let output = "";

    for (let i = 0; i < token.length; i++) {
      const char = token[i];

      if (this.isHiding) {
        // We are currently stripping a JSON block
        // Maintain JSON parsing state to find the end
        if (this.inString) {
          if (char === '"' && !this.isEscaping) {
            this.inString = false;
          } else if (char === "\\" && !this.isEscaping) {
            this.isEscaping = true;
          } else {
            this.isEscaping = false;
          }
        } else {
          if (char === '"') {
            this.inString = true;
          } else if (char === "{") {
            this.braceCount++;
          } else if (char === "}") {
            this.braceCount--;
            if (this.braceCount === 0) {
              // End of the hidden JSON block
              this.isHiding = false;
              this.buffer = ""; // Clear buffer as we consumed the block
              continue; // Skip the closing brace itself
            }
          }
        }
        // Swallow character (don't add to output)
      } else {
        // Normal mode - check for start of JSON
        this.buffer += char;

        // Optimization: valid text usually doesn't have '{' followed by quotes
        const openBraceIndex = this.buffer.indexOf("{");

        if (openBraceIndex === -1) {
          // No opening brace, safe to output everything
          output += this.buffer;
          this.buffer = "";
        } else {
          // We have an opening brace. Output everything before it.
          if (openBraceIndex > 0) {
            output += this.buffer.substring(0, openBraceIndex);
            this.buffer = this.buffer.substring(openBraceIndex);
          }

          // Check if buffer matches a target pattern
          // Matches format: {\s*"key" or {"key"
          // We need enough chars to decide.
          const bufferContent = this.buffer.replace(/\s+/g, ""); // Compact for checking

          // Check if it definitely matches one of our targets
          const isTargetMatch = this.targetKeys.some((key) =>
            bufferContent.startsWith("{" + key)
          );

          if (isTargetMatch) {
            this.isHiding = true;
            this.braceCount = 1;
            this.buffer = ""; // Consumed into hiding mode
          } else {
            // Check if it's a partial match (could be one of ours)
            // e.g. '{"' or '{"ans'
            const isPartialMatch = this.targetKeys.some((key) =>
              ("{" + key).startsWith(bufferContent)
            );

            if (!isPartialMatch) {
              // It's not one of ours. Flush specific chars that disqualified it.
              // We only flush the '{' if we are sure it's not ours.
              // Actually, simpler: if not partial match, flush the buffer (it's normal text)
              output += this.buffer;
              this.buffer = "";
            }
            // else: wait for more chars (keep in buffer)
          }
        }
      }
    }
    return output;
  }

  write(chunk, encoding, callback) {
    // Intercept the write call
    // The chunk is expected to be an SSE string: "data: {...}\n\n"
    let chunkString;
    if (Buffer.isBuffer(chunk)) {
      chunkString = chunk.toString(encoding || "utf8");
    } else {
      chunkString = chunk;
    }

    // Try to parse SSE frame
    // We expect "data: " prefix
    if (chunkString.startsWith("data: ")) {
      try {
        const jsonStr = chunkString.substring(6).trim(); // Remove "data: " and "\n\n"
        if (jsonStr === "[DONE]") {
          // Pass through [DONE]
          return this.originalResponse.write(chunk, encoding, callback);
        }

        const data = JSON.parse(jsonStr);

        // We only care about textResponseChunk types
        if (data.type === "textResponseChunk" && data.textResponse) {
          const processedText = this.processToken(data.textResponse);

          // If we have content to output, write it
          // OR if it's the final close=true chunk, we must write it even if text is empty (to close stream)
          if (processedText || data.close) {
            data.textResponse = processedText;
            this.originalResponse.write(
              `data: ${safeJSONStringify(data)}\n\n`,
              encoding,
              callback
            );
          } else {
            // If text was stripped completely and not closing, verify if we should emit empty?
            // Sending empty chunks is fine/harmless usually, keeps connection alive.
            // But let's only send if we have a callback to acknowledge?
            if (callback) callback();
            return true;
          }
        } else {
          // Pass through other types (abort, finalizeResponseStream, etc.)
          // Note: finalizeResponseStream might contain the FULL GTD data we specifically WANT to send?
          // The user requirement was to hide it from the "UI" (chat text).
          // `finalizeResponseStream` sends structured `gtdData` which frontend uses for distinct visualizers.
          // This is ALLOWED and DESIRED. We only stripped the raw text echo.
          return this.originalResponse.write(chunk, encoding, callback);
        }
      } catch (e) {
        // valid JSON/process failed, pass through raw to be safe
        return this.originalResponse.write(chunk, encoding, callback);
      }
    } else {
      // Not SSE format? Pass through.
      return this.originalResponse.write(chunk, encoding, callback);
    }
  }

  end(chunk, encoding, callback) {
    if (chunk) {
      this.write(chunk, encoding, () => {
        this.originalResponse.end(null, null, callback);
      });
    } else {
      this.originalResponse.end(null, null, callback);
    }
  }
}

module.exports = { ResponseProxy };
