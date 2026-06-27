// stats.js — aggregate progress into chapters, weak words, etc.

import { storage, wordKeyOf, parseWordKey } from './storage.js';
import { getWords, getChapters, getWordsForList } from './data.js';

export function chapterProgress(chapter) {
  const all = storage.getAllProgress();
  const total = getChapters().find(c => c.chapter === String(chapter))?.count || 0;
  let attempted = 0;
  let mastered = 0;
  let weak = 0;
  for (const w of getWords()) {
    if (String(w.chapter) !== String(chapter)) continue;
    const key = wordKeyOf(w);
    const p = all[key];
    if (!p) continue;
    attempted++;
    if ((p.score || 0) >= 7) mastered++;
    if ((p.score || 0) < 5) weak++;
  }
  return {
    total,
    attempted,
    mastered,
    weak,
    ratio: total ? attempted / total : 0,
    mastery: total ? mastered / total : 0,
  };
}

export function overallProgress() {
  const total = getWords().length;
  const all = storage.getAllProgress();
  let attempted = 0;
  let mastered = 0;
  let totalScore = 0;
  let scoreCount = 0;
  for (const w of getWords()) {
    const p = all[wordKeyOf(w)];
    if (p) {
      attempted++;
      if ((p.score || 0) >= 7) mastered++;
      if (typeof p.score === 'number') {
        totalScore += p.score;
        scoreCount++;
      }
    }
  }
  return {
    total,
    attempted,
    mastered,
    avgScore: scoreCount ? +(totalScore / scoreCount).toFixed(2) : 0,
    ratio: total ? attempted / total : 0,
    mastery: total ? mastered / total : 0,
  };
}

export function listProgress(chapter, list) {
  const all = storage.getAllProgress();
  const words = getWordsForList(chapter, list);
  const total = words.length;
  let attempted = 0;
  let mastered = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (const w of words) {
    const p = all[wordKeyOf(w)];
    if (!p) continue;
    attempted++;
    if ((p.score || 0) >= 7) mastered++;
    if (typeof p.score === 'number') {
      scoreSum += p.score;
      scoreCount++;
    }
  }
  return {
    total,
    attempted,
    mastered,
    avgScore: scoreCount ? +(scoreSum / scoreCount).toFixed(2) : 0,
    ratio: total ? attempted / total : 0,
  };
}

export function getWeakWords(limit = 30) {
  const all = storage.getAllProgress();
  const weak = [];
  for (const w of getWords()) {
    const p = all[wordKeyOf(w)];
    if (!p) continue;
    if ((p.score || 0) < 5 && (p.attempts || 0) >= 1) {
      weak.push({ word: w, score: p.score, attempts: p.attempts });
    }
  }
  weak.sort((a, b) => a.score - b.score || b.attempts - a.attempts);
  return weak.slice(0, limit);
}

export function getRecentWords(limit = 10) {
  const all = storage.getAllProgress();
  const arr = [];
  for (const [key, p] of Object.entries(all)) {
    arr.push({ key, p, w: getWords().find(w => wordKeyOf(w) === key) });
  }
  arr.sort((a, b) => (b.p.lastSeen || 0) - (a.p.lastSeen || 0));
  return arr.filter(x => x.w).slice(0, limit);
}

export function getMasteredWords(limit = 10) {
  const all = storage.getAllProgress();
  const arr = [];
  for (const [key, p] of Object.entries(all)) {
    if ((p.score || 0) >= 7) {
      const w = getWords().find(w => wordKeyOf(w) === key);
      if (w) arr.push({ word: w, score: p.score });
    }
  }
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, limit);
}
