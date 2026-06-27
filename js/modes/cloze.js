// modes/cloze.js — 看词造句
// Display a word + Chinese gloss; user writes a sentence containing it.
// Local pass checks: word present (lemma-tolerant), basic length, terminal punctuation.
// LLM (when configured) provides grammar / naturalness / improved version.

import { storage, wordKeyOf } from '../storage.js';
import { chatCompletion, parseLooseJson, isLLMConfigured } from '../llm.js';
import { el, toast, escapeHtml } from '../ui.js';
import { recordAndAdvance } from './common.js';

function localCheck(word, sentence) {
  const issues = [];
  const text = sentence.trim();
  if (!text) {
    issues.push({ level: 'fail', msg: '请先写一句英文。' });
    return { ok: false, issues, score: 0 };
  }
  if (!/[.!?。！？]$/.test(text)) {
    issues.push({ level: 'warn', msg: '句子好像没以句号/问号/感叹号结尾。' });
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) {
    issues.push({ level: 'warn', msg: `句子太短了（仅 ${tokens.length} 词），尽量写长一些。` });
  }
  if (!/^[A-Z]/.test(text)) {
    issues.push({ level: 'warn', msg: '英文句子通常以大写字母开头。' });
  }
  // lemma-tolerant match: word, words, wording, atmosphered? — at least the stem appears
  const wLower = word.toLowerCase().replace(/[^a-z]/g, '');
  const lowerText = text.toLowerCase();
  const wordFound = containsLemma(lowerText, wLower);
  if (!wordFound) {
    issues.push({ level: 'fail', msg: `句子里没找到 "${word}"（含复数/时态变化）。` });
  }
  const ok = !issues.some(i => i.level === 'fail');
  // base score: starts at 7; deduct on warns
  let score = 7;
  if (wordFound) score += 1;
  for (const i of issues) {
    if (i.level === 'warn') score -= 1.5;
    if (i.level === 'fail') score -= 3;
  }
  score = Math.max(0, Math.min(10, score));
  return { ok, issues, score };
}

// very small stemming — drop common suffixes to find a stem match
function containsLemma(text, stem) {
  if (!stem) return true;
  if (text.includes(stem)) return true;
  // try -s -ed -ing -ly -er -est forms
  const suffixes = ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est'];
  for (const suf of suffixes) {
    if (text.includes(stem + suf)) return true;
    // doubled consonant: stop -> stopped, running
    if (stem.length >= 3 && /[bcdfghjklmnpqrstvwxyz]$/.test(stem)) {
      const doubled = stem + stem.slice(-1) + suf;
      if (text.includes(doubled)) return true;
    }
    // e-drop: make -> making, change -> changing
    if (stem.endsWith('e')) {
      if (text.includes(stem.slice(0, -1) + suf)) return true;
      if (text.includes(stem.slice(0, -1) + suf + 'e')) return true;
    }
    // y -> i: happy -> happily
    if (stem.endsWith('y')) {
      if (text.includes(stem.slice(0, -1) + 'i' + suf)) return true;
    }
  }
  return false;
}

const CLOZE_SYSTEM = `You are an IELTS writing examiner helping a Chinese learner with active vocabulary recall.

The learner is given a target word and writes a sentence containing it.

Evaluate the sentence strictly. Return ONLY a JSON object with these fields:
{
  "uses_target_word": true|false,        // does the learner use the target word (in any correct form)?
  "grammar_score": 0-10,                 // grammatical correctness
  "naturalness_score": 0-10,             // how natural a native speaker would find it
  "vocabulary_score": 0-10,              // overall vocabulary sophistication
  "feedback": "1-3 sentences of feedback in Chinese, pointing out what is good and what to improve",
  "improved_version": "a polished English version of the learner's sentence, OR a better example if the original is poor",
  "errors": ["list of specific grammar/vocab errors in English, e.g. 'subject-verb agreement'"]
}

Be strict but kind. Output ONLY the JSON object.`;

export async function runCloze({ entry, onAdvance, container }) {
  const word = entry.word;
  const def = entry.definition || '';
  const key = wordKeyOf(entry);

  let lastSentence = '';
  let busy = false;

  // --- render initial UI ---
  container.innerHTML = '';
  const root = el('div', { class: 'training-shell' });

  // main column
  const main = el('div', { class: 'training-main' });
  const wordCard = el('div', { class: 'word-card' }, [
    el('div', { class: 'word' }, word),
    el('div', { class: 'gloss' }, def.split(/[；;]/)[0].trim() || def),
    def.includes(';') || def.includes('；') ? el('div', { class: 'gloss-en faint small' }, def) : null,
    el('div', { class: 'hint-row' }, [
      el('span', { class: 'chip' }, `Chapter ${entry.chapter} · List ${entry.list} · #${entry.index}`),
    ]),
  ]);
  main.appendChild(wordCard);

  const editor = el('div', { class: 'editor-card' });
  const ta = el('textarea', {
    class: 'textarea',
    placeholder: `Write one English sentence using "${word}".\n写一句英文，把 "${word}" 用进去。`,
    rows: 4,
  });
  ta.addEventListener('input', () => {
    updateCounts();
  });
  editor.appendChild(ta);
  const foot = el('div', { class: 'editor-foot' });
  const counts = el('div', { class: 'counts' });
  const charCount = el('span', {}, '0 chars');
  const wordCount = el('span', {}, '0 words');
  counts.append(charCount, wordCount);
  foot.append(counts, el('div', { class: 'muted small' }, '提示：句子尽量具体、贴近生活场景。'));
  editor.appendChild(foot);
  main.appendChild(editor);

  const actionRow = el('div', { class: 'row gap-2' });
  const submitBtn = el('button', { class: 'btn primary' }, '提交检查');
  const skipBtn = el('button', { class: 'btn ghost' }, '跳过');
  actionRow.append(submitBtn, skipBtn);
  main.appendChild(actionRow);

  // feedback area
  const fb = el('div', {});
  main.appendChild(fb);

  root.appendChild(main);

  // side panel
  const side = el('aside', { class: 'training-side' });
  side.innerHTML = `
    <h4>训练说明</h4>
    <p>看到单词和中文释义，自己写一句英文把目标词用进去。</p>
    <p class="muted small">本地会先做基础检查（是否包含目标词、长度、大写、句末标点），如已配置 LLM 还会给出语法、自然度评分和改写建议。</p>
    <h4 class="mt-4">快捷键</h4>
    <p class="small"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 提交</p>
    <p class="small"><kbd>Esc</kbd> 跳过</p>
  `;
  root.appendChild(side);
  container.appendChild(root);

  function updateCounts() {
    const text = ta.value;
    charCount.textContent = `${text.length} chars`;
    const toks = text.trim() ? text.trim().split(/\s+/).length : 0;
    wordCount.textContent = `${toks} words`;
  }

  function showFeedback(result, llm) {
    fb.innerHTML = '';
    const wrap = el('div', { class: 'feedback' });

    // verdict
    const pass = result.ok;
    const verdict = el('div', { class: `verdict ${pass ? 'pass' : 'fail'}` });
    verdict.appendChild(el('span', { class: 'verdict-icon' }, pass ? '✓' : '✗'));
    verdict.appendChild(el('span', {}, pass ? '通过基础检查' : '未通过基础检查'));
    wrap.appendChild(verdict);

    // issues list
    if (result.issues.length) {
      const ul = el('div', { class: 'notes' });
      for (const i of result.issues) {
        const li = el('div', {}, [
          el('span', { class: `chip ${i.level === 'fail' ? 'error' : 'warn'}` }, i.level === 'fail' ? '问题' : '提示'),
          ' ',
          i.msg,
        ]);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    }

    // grid
    const grid = el('div', { class: 'feedback-grid' });
    grid.appendChild(scoreCell('总分', llm?.score ?? result.score));
    if (llm) {
      grid.appendChild(scoreCell('语法', llm.grammar_score));
      grid.appendChild(scoreCell('自然度', llm.naturalness_score));
      grid.appendChild(scoreCell('用词', llm.vocabulary_score));
    }
    wrap.appendChild(grid);

    if (llm?.feedback) {
      wrap.appendChild(el('div', { class: 'notes mt-3' }, llm.feedback));
    }
    if (llm?.errors && llm.errors.length) {
      const errs = el('div', { class: 'word-usage' });
      for (const e of llm.errors) {
        errs.appendChild(el('span', { class: 'pill missed' }, `⚠ ${e}`));
      }
      wrap.appendChild(el('div', { class: 'mt-3' }, [el('div', { class: 'small muted' }, '具体问题：'), errs]));
    }
    if (llm?.improved_version) {
      const imp = el('div', { class: 'improved' });
      imp.appendChild(el('h4', {}, '改写建议'));
      imp.appendChild(el('div', { class: 'serif' }, `"${llm.improved_version}"`));
      wrap.appendChild(imp);
    }

    fb.appendChild(wrap);

    // advance controls
    const ctrls = el('div', { class: 'row gap-2 mt-3' });
    const next = el('button', { class: 'btn accent' }, pass ? '下一题 →' : '重来或下一题 →');
    next.addEventListener('click', () => onAdvance(pass ? 'pass' : 'fail'));
    ctrls.appendChild(next);
    fb.appendChild(ctrls);
  }

  function scoreCell(label, value) {
    const cell = el('div', { class: 'cell' });
    cell.appendChild(el('div', { class: 'label' }, label));
    cell.appendChild(el('div', { class: 'value' }, value == null ? '—' : String(value)));
    return cell;
  }

  async function submit() {
    if (busy) return;
    const sentence = ta.value.trim();
    lastSentence = sentence;
    if (!sentence) { toast('请先写一句英文。', 'warn'); return; }
    busy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '检查中…';

    // local check first
    const result = localCheck(word, sentence);

    // LLM (opt-in via config)
    let llm = null;
    if (isLLMConfigured()) {
      try {
        showLoading('LLM 评分中…');
        const txt = await chatCompletion({
          json: true,
          messages: [
            { role: 'system', content: CLOZE_SYSTEM },
            { role: 'user', content: `Target word: ${word}\nGloss (Chinese): ${def}\nLearner's sentence: ${sentence}` },
          ],
        });
        llm = parseLooseJson(txt);
        if (llm) {
          llm.score = avg([llm.grammar_score, llm.naturalness_score, llm.vocabulary_score]);
        }
      } catch (e) {
        toast(`LLM 失败: ${e.message}`, 'error');
      } finally {
        hideLoading();
      }
    }

    showFeedback(result, llm);
    recordAndAdvance({ entry, mode: 'cloze', isCorrect: result.ok, score: llm?.score ?? result.score, sentence });

    busy = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '提交检查';
  }

  submitBtn.addEventListener('click', submit);
  skipBtn.addEventListener('click', () => onAdvance('skip'));

  ta.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      submit();
    } else if (ev.key === 'Escape') {
      onAdvance('skip');
    }
  });

  setTimeout(() => ta.focus(), 30);
}

function avg(arr) {
  const xs = arr.filter(x => typeof x === 'number');
  if (!xs.length) return 0;
  return +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
}

let loadingEl = null;
function showLoading(msg) {
  hideLoading();
  loadingEl = el('div', { class: 'training-loading' }, [
    el('span', { class: 'dot-flashing' }),
    el('span', {}, msg || '处理中…'),
  ]);
  document.body.appendChild(loadingEl);
}
function hideLoading() {
  if (loadingEl) { loadingEl.remove(); loadingEl = null; }
}
