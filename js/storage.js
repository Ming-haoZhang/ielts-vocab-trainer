// storage.js — localStorage wrappers
// Keys:
//   ielts_trainer:progress  : { [wordKey]: {attempts, correct, score, lastSeen} }
//   ielts_trainer:settings  : { llmEndpoint, llmApiKey, llmModel, llmPromptLang }
//   ielts_trainer:weak_words: [wordKey, ...]
//   ielts_trainer:favorites : [wordKey, ...]

const KEY_PROGRESS  = 'ielts_trainer:progress';
const KEY_SETTINGS  = 'ielts_trainer:settings';
const KEY_WEAK      = 'ielts_trainer:weak_words';
const KEY_FAV       = 'ielts_trainer:favorites';
const KEY_HISTORY   = 'ielts_trainer:history'; // last scenes visited

function safeParse(s, fallback) {
  try { return JSON.parse(s) ?? fallback; }
  catch { return fallback; }
}

export const storage = {
  // ---- progress ----
  getProgress(wordKey) {
    const all = safeParse(localStorage.getItem(KEY_PROGRESS), {});
    return all[wordKey] || null;
  },
  getAllProgress() {
    return safeParse(localStorage.getItem(KEY_PROGRESS), {});
  },
  setProgress(wordKey, patch) {
    const all = safeParse(localStorage.getItem(KEY_PROGRESS), {});
    const prev = all[wordKey] || { attempts: 0, correct: 0, score: 0, lastSeen: 0 };
    all[wordKey] = { ...prev, ...patch, lastSeen: Date.now() };
    localStorage.setItem(KEY_PROGRESS, JSON.stringify(all));
    return all[wordKey];
  },
  incrementAttempt(wordKey, mode, isCorrect, score) {
    const all = safeParse(localStorage.getItem(KEY_PROGRESS), {});
    const prev = all[wordKey] || {
      attempts: 0, correct: 0, byMode: {}, score: 0, lastSeen: 0,
    };
    prev.attempts += 1;
    if (isCorrect) prev.correct += 1;
    prev.byMode = prev.byMode || {};
    const bm = prev.byMode[mode] || { attempts: 0, correct: 0, sumScore: 0 };
    bm.attempts += 1;
    if (isCorrect) bm.correct += 1;
    if (typeof score === 'number') bm.sumScore += score;
    prev.byMode[mode] = bm;
    if (typeof score === 'number') {
      // running average
      const total = (prev._totalScore || 0) + score;
      const n = (prev._scoreCount || 0) + 1;
      prev._totalScore = total;
      prev._scoreCount = n;
      prev.score = +(total / n).toFixed(2);
    }
    prev.lastSeen = Date.now();
    all[wordKey] = prev;
    localStorage.setItem(KEY_PROGRESS, JSON.stringify(all));
    return prev;
  },

  // ---- weak words ----
  getWeak() {
    return safeParse(localStorage.getItem(KEY_WEAK), []);
  },
  addWeak(wordKey) {
    const set = new Set(safeParse(localStorage.getItem(KEY_WEAK), []));
    set.add(wordKey);
    localStorage.setItem(KEY_WEAK, JSON.stringify([...set]));
  },
  removeWeak(wordKey) {
    const set = new Set(safeParse(localStorage.getItem(KEY_WEAK), []));
    set.delete(wordKey);
    localStorage.setItem(KEY_WEAK, JSON.stringify([...set]));
  },

  // ---- settings ----
  getSettings() {
    return safeParse(localStorage.getItem(KEY_SETTINGS), {});
  },
  setSettings(patch) {
    const all = safeParse(localStorage.getItem(KEY_SETTINGS), {});
    const next = { ...all, ...patch };
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
    return next;
  },

  // ---- history ----
  pushHistory(entry) {
    const all = safeParse(localStorage.getItem(KEY_HISTORY), []);
    all.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(KEY_HISTORY, JSON.stringify(all.slice(0, 50)));
  },
  getHistory() {
    return safeParse(localStorage.getItem(KEY_HISTORY), []);
  },

  // ---- bulk ----
  clearAll() {
    [KEY_PROGRESS, KEY_SETTINGS, KEY_WEAK, KEY_FAV, KEY_HISTORY].forEach(k =>
      localStorage.removeItem(k)
    );
  },
  exportAll() {
    return {
      progress: this.getAllProgress(),
      settings: this.getSettings(),
      weak: this.getWeak(),
      exportedAt: new Date().toISOString(),
    };
  },
};

// wordKey utilities
export function wordKeyOf(entry) {
  return `${entry.chapter}:${entry.list}:${entry.index}`;
}

export function parseWordKey(key) {
  const [c, l, i] = key.split(':');
  return { chapter: c, list: +l, index: +i };
}
