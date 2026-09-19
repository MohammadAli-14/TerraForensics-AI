import React, { useState, useRef, useCallback } from "react";
import { API_BASE, AUTH_TOKEN } from "@/utils/constants";

const BUTTON_SIZE = 48;

// Custom fetch that adds AnythingLLM auth headers.
// Page-Agent calls fetch(url, opts) internally — we intercept to add auth.
function makeCustomFetch() {
  return async function customFetch(url, options = {}) {
    const token = window.localStorage.getItem(AUTH_TOKEN);
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };
}

export default function PageAgentToggle() {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const agentRef = useRef(null);

  const toggle = useCallback(async () => {
    // If already initialized, just show/hide the panel
    if (agentRef.current) {
      if (active) {
        agentRef.current.panel.hide();
      } else {
        agentRef.current.panel.show();
      }
      setActive((prev) => !prev);
      return;
    }

    // First time — dynamically import and initialize
    setLoading(true);
    try {
      const { PageAgent } = await import("page-agent");

      const agent = new PageAgent({
        // Points to the backend proxy: /api/v1/page-agent
        // The proxy forwards to Ollama's OpenAI-compatible API
        baseURL: `${API_BASE}/v1/page-agent`,
        apiKey: window.localStorage.getItem(AUTH_TOKEN) || "none",
        model: "llama3.1:8b", // Backend overrides this with PAGE_AGENT_MODEL
        language: "en-US",
        customFetch: makeCustomFetch(),
      });

      agentRef.current = agent;
      agent.panel.show();
      setActive(true);
    } catch (err) {
      console.error("[PageAgent] Failed to initialize:", err);
    } finally {
      setLoading(false);
    }
  }, [active]);

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={active ? "Hide Page Agent" : "Show Page Agent"}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 99999,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        borderRadius: "50%",
        border: "none",
        cursor: loading ? "wait" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "#3b82f6" : "#1e293b",
        color: "#ffffff",
        boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
        transition: "background-color 0.2s, transform 0.2s",
        transform: active ? "scale(1.05)" : "scale(1)",
        fontSize: 20,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = active ? "scale(1.05)" : "scale(1)";
      }}
    >
      {loading ? (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ animation: "spin 1s linear infinite" }}
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : (
        // Robot/wand icon
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 4V2" />
          <path d="M15 16v-2" />
          <path d="M8 9h2" />
          <path d="M20 9h2" />
          <path d="M17.8 11.8 19 13" />
          <path d="M15 9h0" />
          <path d="M17.8 6.2 19 5" />
          <path d="m3 21 9-9" />
          <path d="M12.2 6.2 11 5" />
        </svg>
      )}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}
