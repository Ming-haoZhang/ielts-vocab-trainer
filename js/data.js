// data.js — load word list, build lookup indices

import { wordKeyOf } from './storage.js';

let WORDS = null;
let CHAPTERS = null;
let SCENES = null;

// chapter key normalization: "9/10" -> ["9", "10"]
function chapterKeys(chapter) {
  return String(chapter).split('/').filter(Boolean);
}

let BY_KEY = null;        // wordKey -> entry
let BY_CHAPTER_LIST = null; // [chapter][list] -> entries[]

export async function loadAll() {
  if (WORDS && CHAPTERS && SCENES) return;
  const [words, chapters, scenes] = await Promise.all([
    fetch('data/words.json').then(r => r.json()),
    fetch('data/chapters.json').then(r => r.json()),
    fetch('data/scenes.json').then(r => r.json()),
  ]);
  WORDS = words;
  CHAPTERS = chapters;
  SCENES = scenes;

  // Build indices
  BY_KEY = Object.create(null);
  BY_CHAPTER_LIST = Object.create(null);
  for (const w of WORDS) {
    BY_KEY[wordKeyOf(w)] = w;
    for (const ck of chapterKeys(w.chapter)) {
      BY_CHAPTER_LIST[ck] = BY_CHAPTER_LIST[ck] || Object.create(null);
      BY_CHAPTER_LIST[ck][w.list] = BY_CHAPTER_LIST[ck][w.list] || [];
      BY_CHAPTER_LIST[ck][w.list].push(w);
    }
  }
}

export function getWords() {
  return WORDS || [];
}

export function getChapters() {
  return CHAPTERS || [];
}

export function getScenes() {
  return SCENES || [];
}

export function getWordByKey(key) {
  return BY_KEY ? BY_KEY[key] : null;
}

export function getWordsForList(chapter, list) {
  if (!BY_CHAPTER_LIST) return [];
  const chap = BY_CHAPTER_LIST[chapter];
  if (!chap) return [];
  const lst = chap[list];
  return lst ? lst.slice().sort((a, b) => a.index - b.index) : [];
}

export function getListsForChapter(chapter) {
  const c = getChapters().find(c => c.chapter === String(chapter));
  return c ? c.lists : [];
}

export function getChapterName(chapter) {
  const c = getChapters().find(c => c.chapter === String(chapter));
  return c ? c.name : '';
}

export function getScenesForChapter(chapter) {
  if (!SCENES) return [];
  return SCENES.filter(s => String(s.chapter) === String(chapter));
}

export function getScene(id) {
  return SCENES ? SCENES.find(s => s.id === id) : null;
}

export function totalWordCount() {
  return WORDS ? WORDS.length : 0;
}
