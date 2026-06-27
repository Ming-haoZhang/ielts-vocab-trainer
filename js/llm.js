// llm.js — pluggable OpenAI-compatible chat completions client
//
// Required user config (in localStorage via storage.js):
//   llmEndpoint — base URL, e.g. "https://api.openai.com/v1"
//   llmApiKey   — the bearer token
//   llmModel    — model name, e.g. "gpt-4o-mini"
//
// Compatible with: OpenAI, Anthropic-via-proxy, DeepSeek, OpenRouter,
// Moonshot, Ollama /v1, any OpenAI-spec endpoint.

import { storage } from './storage.js';

const LLM_DEFAULTS = {
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export function getLLMConfig() {
  const s = storage.getSettings();
  return {
    endpoint: s.llmEndpoint || '',
    apiKey: s.llmApiKey || '',
    model: s.llmModel || LLM_DEFAULTS.model,
  };
}

export function isLLMConfigured() {
  const c = getLLMConfig();
  return Boolean(c.endpoint && c.apiKey);
}

export function setLLMConfig({ endpoint, apiKey, model }) {
  return storage.setSettings({ llmEndpoint: endpoint, llmApiKey: apiKey, llmModel: model });
}

export async function chatCompletion({ messages, temperature = 0.3, json = false, signal }) {
  const cfg = getLLMConfig();
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('LLM 未配置：请在“设置”页填写 endpoint 与 API key。');
  }
  const url = `${cfg.endpoint.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: cfg.model,
    messages,
    temperature,
  };
  if (json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`无法连接到 LLM 服务: ${e.message || e}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LLM 返回 ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Parse JSON robustly — handles ```json fences and trailing commas
export function parseLooseJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  // strip ```json fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); }
  catch { /* try to find first { ... last } */
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      const inner = s.slice(i, j + 1);
      try { return JSON.parse(inner); } catch { /* fallthrough */ }
    }
    return null;
  }
}
