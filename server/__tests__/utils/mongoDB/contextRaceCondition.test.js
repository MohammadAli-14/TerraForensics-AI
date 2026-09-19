/**
 * Regression Test Suite: GTD Follow-Up Context Multi-User Concurrency
 *
 * Replicates the exact race condition described in Manuscript Section 3.3 and Figure 10:
 * "Two users active in the same workspace currently overwrite each other's stored filter state."
 *
 * Verifies that keying conversationContext by composite (workspace ID + user ID + thread ID)
 * prevents cross-user overwriting and isolates follow-up query filters under concurrent usage.
 */

describe("GTD Conversation Context Concurrency & Isolation (Figure 10 Regression)", () => {
  let contextExtractor;

  beforeEach(() => {
    jest.resetModules();
    contextExtractor = require("../../../utils/mongoDB/contextExtractor");
    // Clear in-memory Map before each test
    contextExtractor.conversationContext.clear();
  });

  describe("Composite Context Key Generation", () => {
    test("should construct composite key as workspace:user:thread from objects", () => {
      const workspace = { id: "ws_intel_01", slug: "intel" };
      const user = { id: "usr_alice", username: "alice" };
      const thread = { id: "th_analysis_a", slug: "thread-a" };

      const key = contextExtractor._buildContextKey(workspace, user, thread);
      expect(key).toBe("ws_intel_01:usr_alice:th_analysis_a");
    });

    test("should construct composite key from string identifiers", () => {
      const key = contextExtractor._buildContextKey("ws_100", "usr_bob", "th_500");
      expect(key).toBe("ws_100:usr_bob:th_500");
    });

    test("should fallback to defaults when arguments are missing", () => {
      expect(contextExtractor._buildContextKey(null)).toBe("default:anonymous:default");
      expect(contextExtractor._buildContextKey("ws_only")).toBe("ws_only:anonymous:default");
    });

    test("should preserve pre-formed composite keys containing colons", () => {
      const existingKey = "workspace_abc:user_xyz:thread_123";
      expect(contextExtractor._buildContextKey(existingKey)).toBe(existingKey);
    });

    test("should strictly use arguments in positional order without heuristic rearrangement", () => {
      const workspace = { id: "ws_01" };
      // Passing thread in the second position (user's position)
      const thread = { id: "th_01", workspace_id: "ws_01", name: "Thread 1" };
      // Passing user in the third position (thread's position)
      const user = { id: "usr_01", username: "analyst" };

      // Since the heuristic was removed, _buildContextKey(ws, thread, user) will treat thread as user and user as thread
      const key = contextExtractor._buildContextKey(workspace, thread, user);
      expect(key).toBe("ws_01:th_01:usr_01");
    });
  });

  describe("Figure 10 Race Condition Reproduction & Resolution", () => {
    const sharedWorkspace = { id: "ws_shared_gtd", slug: "gtd-workspace" };

    const userA = { id: "user_A", username: "analyst_alice" };
    const threadA = { id: "thread_A", slug: "investigation-iraq" };

    const userB = { id: "user_B", username: "analyst_bob" };
    const threadB = { id: "thread_B", slug: "investigation-suicide" };

    test("demonstrates why workspace-only keying caused the Figure 10 race condition", () => {
      // In the legacy un-isolated architecture:
      // Map was keyed solely by workspace.id ("ws_shared_gtd")
      const legacyMap = new Map();

      // Step 1: User A executes "Attacks in Iraq?"
      legacyMap.set(sharedWorkspace.id, {
        country_txt: "Iraq",
        lastQuery: "Attacks in Iraq?",
      });

      // Step 2: User B executes "Suicide bombings?" in the same workspace
      legacyMap.set(sharedWorkspace.id, {
        suicide: "1",
        lastQuery: "Suicide bombings?",
      });

      // Step 3: User A attempts to retrieve context for follow-up "What about 2015?"
      const userARetrieved = legacyMap.get(sharedWorkspace.id);

      // BUG REPRODUCED: User A receives User B's suicide filter instead of Iraq!
      expect(userARetrieved.country_txt).toBeUndefined();
      expect(userARetrieved.suicide).toBe("1");
      expect(userARetrieved.lastQuery).toBe("Suicide bombings?");
    });

    test("confirms composite key prevents User B from overwriting User A's filter state", () => {
      // Step 1: User A in shared workspace asks "Attacks in Iraq?"
      contextExtractor.storeContext(
        sharedWorkspace,
        {
          country_txt: "Iraq",
          lastQuery: "Attacks in Iraq?",
          lastResult: "stats",
        },
        userA,
        threadA
      );

      // Verify User A context is stored
      const storedAInitial = contextExtractor.getStoredContext(
        sharedWorkspace,
        userA,
        threadA
      );
      expect(storedAInitial).not.toBeNull();
      expect(storedAInitial.country_txt).toBe("Iraq");

      // Step 2: User B in SAME workspace asks "Suicide bombings?"
      contextExtractor.storeContext(
        sharedWorkspace,
        {
          suicide: "1",
          lastQuery: "Suicide bombings?",
          lastResult: "stats",
        },
        userB,
        threadB
      );

      // Step 3: Verify User A's context remains intact and NOT overwritten
      const storedAAfterUserB = contextExtractor.getStoredContext(
        sharedWorkspace,
        userA,
        threadA
      );
      expect(storedAAfterUserB).not.toBeNull();
      expect(storedAAfterUserB.country_txt).toBe("Iraq");
      expect(storedAAfterUserB.suicide).toBeUndefined();
      expect(storedAAfterUserB.lastQuery).toBe("Attacks in Iraq?");

      // Step 4: Verify User B's context is independently stored
      const storedB = contextExtractor.getStoredContext(
        sharedWorkspace,
        userB,
        threadB
      );
      expect(storedB).not.toBeNull();
      expect(storedB.suicide).toBe("1");
      expect(storedB.country_txt).toBeUndefined();
      expect(storedB.lastQuery).toBe("Suicide bombings?");

      // Verify internal storage has exactly 2 distinct entries
      expect(contextExtractor.conversationContext.size).toBe(2);
      expect(
        contextExtractor.conversationContext.has("ws_shared_gtd:user_A:thread_A")
      ).toBe(true);
      expect(
        contextExtractor.conversationContext.has("ws_shared_gtd:user_B:thread_B")
      ).toBe(true);
    });

    test("interleaved follow-up queries maintain strict per-user filter isolation", () => {
      // Step 1: User A sets initial context
      contextExtractor.storeContext(
        sharedWorkspace,
        { country_txt: "Iraq", resultCount: 24000 },
        userA,
        threadA
      );

      // Step 2: User B sets initial context
      contextExtractor.storeContext(
        sharedWorkspace,
        { country_txt: "Pakistan", attacktype1_txt: "Bombing/Explosion" },
        userB,
        threadB
      );

      // Step 3: User A sends follow-up query: "What about 2015?"
      const userAContext = contextExtractor.getStoredContext(
        sharedWorkspace,
        userA,
        threadA
      );
      const userAConditions = {
        country_txt: userAContext.country_txt,
        iyear: 2015,
      };

      // User A updates their context with new year
      contextExtractor.storeContext(
        sharedWorkspace,
        { ...userAContext, iyear: 2015 },
        userA,
        threadA
      );

      // Step 4: User B sends follow-up query: "in 2016"
      const userBContext = contextExtractor.getStoredContext(
        sharedWorkspace,
        userB,
        threadB
      );
      const userBConditions = {
        country_txt: userBContext.country_txt,
        attacktype1_txt: userBContext.attacktype1_txt,
        iyear: 2016,
      };

      // User B updates their context
      contextExtractor.storeContext(
        sharedWorkspace,
        { ...userBContext, iyear: 2016 },
        userB,
        threadB
      );

      // Final Assertions: Neither context polluted the other
      expect(userAConditions).toEqual({
        country_txt: "Iraq",
        iyear: 2015,
      });

      expect(userBConditions).toEqual({
        country_txt: "Pakistan",
        attacktype1_txt: "Bombing/Explosion",
        iyear: 2016,
      });

      const finalA = contextExtractor.getStoredContext(sharedWorkspace, userA, threadA);
      const finalB = contextExtractor.getStoredContext(sharedWorkspace, userB, threadB);

      expect(finalA.country_txt).toBe("Iraq");
      expect(finalA.iyear).toBe(2015);
      expect(finalA.attacktype1_txt).toBeUndefined();

      expect(finalB.country_txt).toBe("Pakistan");
      expect(finalB.iyear).toBe(2016);
      expect(finalB.attacktype1_txt).toBe("Bombing/Explosion");
    });
  });

  describe("Multi-Thread Isolation for the Same User", () => {
    test("different threads under the same user and workspace remain isolated", () => {
      const workspace = { id: "ws_analyst" };
      const user = { id: "user_alice" };
      const thread1 = { id: "thread_syria" };
      const thread2 = { id: "thread_yemen" };

      contextExtractor.storeContext(
        workspace,
        { country_txt: "Syria" },
        user,
        thread1
      );
      contextExtractor.storeContext(
        workspace,
        { country_txt: "Yemen" },
        user,
        thread2
      );

      const retrievedT1 = contextExtractor.getStoredContext(workspace, user, thread1);
      const retrievedT2 = contextExtractor.getStoredContext(workspace, user, thread2);

      expect(retrievedT1.country_txt).toBe("Syria");
      expect(retrievedT2.country_txt).toBe("Yemen");
    });
  });

  describe("Embedded Widget Isolation", () => {
    test("embed widget sessions are isolated using sessionId and username", () => {
      const workspace = { id: "ws_embed" };
      // embed.js passes { username } and { slug: sessionId }
      const user1 = { username: "visitor1" };
      const thread1 = { slug: "session_123" };
      const user2 = { username: "visitor2" };
      const thread2 = { slug: "session_456" };

      contextExtractor.storeContext(
        workspace,
        { country_txt: "Brazil" },
        user1,
        thread1
      );
      contextExtractor.storeContext(
        workspace,
        { country_txt: "Argentina" },
        user2,
        thread2
      );

      const retrieved1 = contextExtractor.getStoredContext(workspace, user1, thread1);
      const retrieved2 = contextExtractor.getStoredContext(workspace, user2, thread2);

      expect(retrieved1.country_txt).toBe("Brazil");
      expect(retrieved2.country_txt).toBe("Argentina");
      
      const key1 = contextExtractor._buildContextKey(workspace, user1, thread1);
      const key2 = contextExtractor._buildContextKey(workspace, user2, thread2);
      expect(key1).toBe("ws_embed:visitor1:session_123");
      expect(key2).toBe("ws_embed:visitor2:session_456");
    });
  });

  describe("TTL and Eviction Rules Preservation", () => {
    test("preserves 5-minute TTL constant", () => {
      expect(contextExtractor.contextTimeout).toBe(5 * 60 * 1000);
    });

    test("evicts context when timestamp exceeds contextTimeout", () => {
      const workspace = { id: "ws_ttl" };
      const user = { id: "user_ttl" };
      const thread = { id: "thread_ttl" };

      contextExtractor.storeContext(
        workspace,
        { country_txt: "Egypt" },
        user,
        thread
      );

      const key = contextExtractor._buildContextKey(workspace, user, thread);
      const entry = contextExtractor.conversationContext.get(key);
      expect(entry).toBeDefined();

      // Simulate passing of 5 minutes + 1 second
      entry.timestamp = Date.now() - (5 * 60 * 1000 + 1000);

      const retrieved = contextExtractor.getStoredContext(workspace, user, thread);
      expect(retrieved).toBeNull();
      // Verifies eviction occurred
      expect(contextExtractor.conversationContext.has(key)).toBe(false);
    });
  });
});
