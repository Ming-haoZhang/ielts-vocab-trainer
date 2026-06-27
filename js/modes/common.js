// modes/common.js — shared helpers across training modes

import { storage, wordKeyOf } from '../storage.js';

export function recordAndAdvance({ entry, mode, isCorrect, score, sentence, sceneId }) {
  const key = wordKeyOf(entry);
  storage.incrementAttempt(key, mode, isCorrect, score);
  if (sentence) {
    const all = storage.getAllProgress();
    const cur = all[key] || {};
    cur.samples = cur.samples || [];
    cur.samples.unshift({ mode, sentence, score, ts: Date.now() });
    cur.samples = cur.samples.slice(0, 5);
    all[key] = cur;
    localStorage.setItem('ielts_trainer:progress', JSON.stringify(all));
  }
  if (!isCorrect && typeof score === 'number' && score < 5) {
    storage.addWeak(key);
  } else if (isCorrect && typeof score === 'number' && score >= 7) {
    storage.removeWeak(key);
  }
  if (sceneId) {
    storage.pushHistory({ mode, sceneId, chapter: entry.chapter, list: entry.list });
  }
}

export function nextWordInList(words, currentKey, direction = 1) {
  if (!words.length) return null;
  const idx = words.findIndex(w => wordKeyOf(w) === currentKey);
  if (idx < 0) return words[0];
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= words.length) return words[idx];
  return words[nextIdx];
}
