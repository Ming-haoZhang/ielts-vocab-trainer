// modes/upgrade.js — 句子升级
// Show a naive sentence using simple vocabulary + the target word.
// User rewrites it more "雅" (sophisticated / IELTS-style).
// LLM evaluates improvement, grammar, sophistication.

import { storage, wordKeyOf } from '../storage.js';
import { chatCompletion, parseLooseJson, isLLMConfigured } from '../llm.js';
import { el, toast } from '../ui.js';
import { recordAndAdvance } from './common.js';
import { getWordsForList } from '../data.js';
import { nextWordInList } from './common.js';

// naive sentence templates per POS — fallback when no curated example
const NAIVE_TEMPLATES = {
  n: 'The {w} was there.',
  v: 'I {w} it.',
  adj: 'It was {w}.',
  adv: 'It was done {w}.',
};

function naiveSentenceFor(entry) {
  const w = entry.word;
  // try to detect POS from definition
  const def = (entry.definition || '').toLowerCase();
  let pos = 'n';
  if (/\b(v\.|verb|动词)/.test(def)) pos = 'v';
  else if (/\b(adj\.|adjective|形容词)/.test(def)) pos = 'adj';
  else if (/\b(adv\.|adverb|副词)/.test(def)) pos = 'adv';

  const tpl = NAIVE_TEMPLATES[pos] || NAIVE_TEMPLATES.n;
  let s = tpl.replace('{w}', w);
  // adjust for verb
  if (pos === 'v') {
    // try to guess verb form: use base
    s = s;
  }
  return s;
}

const UPGRADE_SYSTEM = `You are an IELTS writing examiner. The learner is given:
- A "naive" sentence written with simple vocabulary.
- A target word they must include.
- Their "upgraded" rewrite.

Evaluate the rewrite. Return ONLY a JSON object:
{
  "uses_target_word": true|false,
  "improvement_score": 0-10,    // how much better than the naive version
  "grammar_score": 0-10,
  "sophistication_score": 0-10, // advanced vocabulary, complex structures
  "feedback": "1-3 sentences in Chinese explaining strengths and weaknesses",
  "errors": ["list of specific errors in English"],
  "better_version": "a more polished rewrite that the learner can compare against"
}

Be strict: do NOT award improvement_score >= 7 unless the rewrite is genuinely more sophisticated (longer meaningful clauses, less common collocations, better academic register).
Output ONLY the JSON object.`;

export async function runUpgrade({ entry, container, onAdvance }) {
  const word = entry.word;
  const def = entry.definition || '';
  const key = wordKeyOf(entry);

  const naive = naiveSentenceFor(entry);

  container.innerHTML = '';
  const root = el('div', { class: 'training-shell' });

  const main = el('div', { class: 'training-main' });

  const wordCard = el('div', { class: 'word-card' }, [
    el('div', { class: 'word' }, word),
    el('div', { class: 'gloss' }, def.split(/[；;]/)[0].trim() || def),
    el('div', { class: 'hint-row' }, [
      el('span', { class: 'chip accent' }, `升级训练`),
      el('span', { class: 'chip' }, `Chapter ${entry.chapter} · List ${entry.list}`),
    ]),
  ]);
  main.appendChild(wordCard);

  const sceneCard = el('div', { class: 'scene-card' });
  sceneCard.appendChild(el('div', { class: 'scene-meta' }, '把下面这个朴素的句子升级成更"雅"的版本（必须保留目标词）'));
  const diff = el('div', { class: 'diff' });
  diff.appendChild(el('div', {}, [
    el('div', { class: 'col-label' }, '原文（朴素版）'),
    el('div', { class: 'text serif' }, `"${naive}"`),
  ]));
  diff.appendChild(el('div', {}, [
    el('div', { class: 'col-label' }, '你的升级版'),
    el('div', { class: 'text serif faint' }, '请在下方编辑框中改写…'),
  ]));
  sceneCard.appendChild(diff);
  main.appendChild(sceneCard);

  const editor = el('div', { class: 'editor-card large' });
  const ta = el('textarea', {
    class: 'textarea',
    placeholder: `Rewrite the sentence using "${word}". Make it more sophisticated, longer, or more academic.\n在保留 "${word}" 的前提下，把句子改得更"雅"。`,
    rows: 5,
  });
  editor.appendChild(ta);
  const foot = el('div', { class: 'editor-foot' });
  const counts = el('div', { class: 'counts' });
  const charCount = el('span', {}, '0 chars');
  const wordCount = el('span', {}, '0 words');
  counts.append(charCount, wordCount);
  foot.append(counts, el('div', { class: 'muted small' }, '提示：尝试用从句、非谓语动词、连接词替换简单句。'));
  editor.appendChild(foot);
  main.appendChild(editor);

  ta.addEventListener('input', () => {
    const text = ta.value;
    charCount.textContent = `${text.length} chars`;
    const toks = text.trim() ? text.trim().split(/\s+/).length : 0;
    wordCount.textContent = `${toks} words`;
  });

  const actionRow = el('div', { class: 'row gap-2' });
  const submitBtn = el('button', { class: 'btn primary' }, '提交评分');
  const skipBtn = el('button', { class: 'btn ghost' }, '跳过');
  actionRow.append(submitBtn, skipBtn);
  main.appendChild(actionRow);

  const fb = el('div', {});
  main.appendChild(fb);

  root.appendChild(main);

  const side = el('aside', { class: 'training-side' });
  side.innerHTML = `
    <h4>训练说明</h4>
    <p>看到一个朴素句子（用最基础的词汇），你的任务是把它"升级"成雅思/学术风格的更复杂表达。</p>
    <p class="muted small">可以尝试：加入定语从句、用更高级的同义词、用非谓语结构代替两个短句、加入衔接词。</p>
    <h4 class="mt-4">快捷键</h4>
    <p class="small"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 提交</p>
    <p class="small"><kbd>Esc</kbd> 跳过</p>
  `;
  root.appendChild(side);
  container.appendChild(root);

  async function submit() {
    if (submitBtn.disabled) return;
    const upgraded = ta.value.trim();
    if (!upgraded) { toast('请先写升级版。', 'warn'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = '评分中…';
    showLoading('LLM 评分中…');

    let llm = null;
    let err = null;
    if (!isLLMConfigured()) {
      err = 'LLM 未配置：请到“设置”页填写 API 信息。';
    } else {
      try {
        const txt = await chatCompletion({
          json: true,
          messages: [
            { role: 'system', content: UPGRADE_SYSTEM },
            { role: 'user', content: `Target word: ${word}\nGloss (Chinese): ${def}\nNaive sentence: ${naive}\nLearner's upgrade: ${upgraded}` },
          ],
        });
        llm = parseLooseJson(txt);
      } catch (e) {
        err = e.message || String(e);
      }
    }
    hideLoading();

    fb.innerHTML = '';
    const wrap = el('div', { class: 'feedback' });

    if (err) {
      wrap.appendChild(el('div', { class: 'verdict fail' }, [
        el('span', { class: 'verdict-icon' }, '!'),
        el('span', {}, err),
      ]));
    } else if (llm) {
      const passed = llm.improvement_score >= 5 && llm.uses_target_word;
      const verdict = el('div', { class: `verdict ${passed ? 'pass' : 'fail'}` });
      verdict.appendChild(el('span', { class: 'verdict-icon' }, passed ? '✓' : '✗'));
      verdict.appendChild(el('span', {}, passed ? '升级有效' : '需要再升级'));
      wrap.appendChild(verdict);

      const grid = el('div', { class: 'feedback-grid' });
      const overall = avg([llm.improvement_score, llm.grammar_score, llm.sophistication_score]);
      grid.appendChild(scoreCell('总分', overall));
      grid.appendChild(scoreCell('升级幅度', llm.improvement_score));
      grid.appendChild(scoreCell('语法', llm.grammar_score));
      grid.appendChild(scoreCell('用词档次', llm.sophistication_score));
      wrap.appendChild(grid);

      if (llm.feedback) wrap.appendChild(el('div', { class: 'notes mt-3' }, llm.feedback));
      if (llm.errors?.length) {
        const errs = el('div', { class: 'word-usage' });
        for (const e of llm.errors) errs.appendChild(el('span', { class: 'pill missed' }, `⚠ ${e}`));
        wrap.appendChild(el('div', { class: 'mt-3' }, [el('div', { class: 'small muted' }, '具体问题：'), errs]));
      }
      if (llm.better_version) {
        const imp = el('div', { class: 'improved' });
        imp.appendChild(el('h4', {}, '更雅的版本'));
        imp.appendChild(el('div', { class: 'serif' }, `"${llm.better_version}"`));
        wrap.appendChild(imp);
      }

      recordAndAdvance({ entry, mode: 'upgrade', isCorrect: passed, score: overall, sentence: upgraded });
    }

    fb.appendChild(wrap);

    const ctrls = el('div', { class: 'row gap-2 mt-3' });
    const next = el('button', { class: 'btn accent' }, '下一题 →');
    next.addEventListener('click', () => onAdvance(llm?.improvement_score >= 5 ? 'pass' : 'fail'));
    ctrls.appendChild(next);
    fb.appendChild(ctrls);

    submitBtn.disabled = false;
    submitBtn.textContent = '提交评分';
  }

  submitBtn.addEventListener('click', submit);
  skipBtn.addEventListener('click', () => onAdvance('skip'));
  ta.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); submit(); }
    else if (ev.key === 'Escape') onAdvance('skip');
  });
  setTimeout(() => ta.focus(), 30);
}

function avg(arr) {
  const xs = arr.filter(x => typeof x === 'number');
  if (!xs.length) return 0;
  return +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
}
function scoreCell(label, value) {
  const cell = el('div', { class: 'cell' });
  cell.appendChild(el('div', { class: 'label' }, label));
  cell.appendChild(el('div', { class: 'value' }, value == null ? '—' : String(value)));
  return cell;
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
