// modes/scene.js — 情境造句
// Show an IELTS-style writing prompt + 3-5 target words.
// User writes a paragraph. LLM evaluates per-word usage + overall band score.

import { storage, wordKeyOf } from '../storage.js';
import { chatCompletion, parseLooseJson, isLLMConfigured } from '../llm.js';
import { el, toast } from '../ui.js';
import { recordAndAdvance } from './common.js';

const SCENE_SYSTEM = `You are an IELTS Writing examiner. The learner writes a paragraph (100-180 words) responding to a writing prompt. They are given 6-10 target vocabulary words and are expected to use AT LEAST 5 of them naturally — forcing awkward usage is a failure mode, not a success.

This training is specifically about "遣词造句" (deliberate word deployment): the learner is trying to internalize these words so they can recall them later. Natural usage, correct collocations, and accurate meaning matter far more than quantity of usage.

Evaluate the paragraph strictly. Return ONLY a JSON object with these fields:
{
  "words": [
    {
      "word": "<target word>",
      "used": true|false,
      "score": 0-10,                              // 0 if not used; 6-8 if used correctly but ordinary; 9-10 if used precisely with strong collocation
      "feedback": "<one sentence in Chinese about how it was used — be specific: collocation errors, meaning errors, awkward placement>"
    },
    ...
  ],
  "words_used_count": 0-10,    // how many of the targets were actually used
  "task_response": 0-10,       // does it answer the prompt with clear position + supporting reasons?
  "grammar": 0-10,
  "vocabulary_range": 0-10,    // overall lexical range, beyond just the targets
  "coherence": 0-10,           // logical flow, paragraphing, cohesion devices
  "overall_band": 0-9,         // IELTS-style band, can be 0.5 increments
  "feedback": "2-4 sentences in Chinese: 1) what was done well, 2) which words need more practice, 3) one concrete improvement suggestion",
  "errors": ["list specific grammar/vocab errors in English, e.g. 'subject-verb agreement in sentence 2'"],
  "improved_paragraph": "a polished rewrite of the learner's paragraph, naturally using ALL target words correctly"
}

Strict grading principles:
- A word used but with wrong meaning → score 2-3
- A word forced in awkwardly (breaks sentence flow) → score 3-4
- A word used correctly but generically → score 6-7
- A word used precisely with good collocation → score 8-10
- Don't reward "padding" the paragraph to hit the word count — quality > length
Output ONLY the JSON object.`;

export async function runScene({ scene, entries, container, onAdvance }) {
  container.innerHTML = '';
  const root = el('div', { class: 'training-shell' });

  const main = el('div', { class: 'training-main' });

  const sceneCard = el('div', { class: 'scene-card' });
  sceneCard.appendChild(el('div', { class: 'scene-meta' },
    `Chapter ${entries[0].chapter} · ${scene.id || ''} · 目标 ${entries.length} 词`));
  sceneCard.appendChild(el('div', { class: 'scene-prompt' }, scene.prompt));
  if (scene.note) sceneCard.appendChild(el('div', { class: 'muted small mt-3' }, scene.note));
  const hints = el('div', { class: 'scene-hints' });
  for (const e of entries) {
    hints.appendChild(el('span', { class: 'chip accent' }, `${e.word} · ${(e.definition||'').split(/[;；]/)[0]}`));
  }
  sceneCard.appendChild(el('div', { class: 'mt-3 small muted' }, `请自然地使用以下 ${entries.length} 个本单元的词（至少用上 5 个）：建议 100-180 词。`));
  sceneCard.appendChild(hints);
  main.appendChild(sceneCard);

  const editor = el('div', { class: 'editor-card large' });
  const ta = el('textarea', {
    class: 'textarea',
    placeholder: `Write 100-180 words responding to the prompt. Naturally use at least 5 of the target words above.\n写 100-180 词回应话题，自然地用上至少 5 个目标词。`,
    rows: 10,
  });
  editor.appendChild(ta);
  const foot = el('div', { class: 'editor-foot' });
  const counts = el('div', { class: 'counts' });
  const charCount = el('span', {}, '0 chars');
  const wordCount = el('span', {}, '0 words');
  counts.append(charCount, wordCount);
  foot.append(counts, el('div', { class: 'muted small' }, 'Ctrl+Enter 提交'));
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
    <h4>情境造句训练</h4>
    <p>给一个雅思常见话题，写一段 80-180 词的回应。</p>
    <p class="muted small">强制要求：用上本单元的 3-5 个目标词。LLM 会按雅思写作标准（任务回应、词汇、语法、连贯）评分并打分。</p>
    <h4 class="mt-4">提示</h4>
    <p class="small">先快速列提纲（开头-主体-结尾），再写。</p>
  `;
  root.appendChild(side);
  container.appendChild(root);

  async function submit() {
    if (submitBtn.disabled) return;
    const paragraph = ta.value.trim();
    if (!paragraph) { toast('请先写一段。', 'warn'); return; }
    if (paragraph.split(/\s+/).length < 60) {
      toast('太短了（< 60 词），段落造句建议至少 60 词。', 'warn');
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '评分中…';
    showLoading('LLM 评分中（可能需要几秒）…');

    let llm = null;
    let err = null;
    if (!isLLMConfigured()) {
      err = 'LLM 未配置：请到“设置”页填写 API 信息。';
    } else {
      try {
        const txt = await chatCompletion({
          json: true,
          messages: [
            { role: 'system', content: SCENE_SYSTEM },
            { role: 'user', content:
              `Prompt: ${scene.prompt}\nTarget words: ${entries.map(e => e.word).join(', ')}\nLearner's paragraph:\n${paragraph}`
            },
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
      const overall = avg([
        llm.task_response, llm.grammar, llm.vocabulary_range, llm.coherence,
      ]);
      const passed = overall >= 6;
      const verdict = el('div', { class: `verdict ${passed ? 'pass' : 'warn'}` });
      verdict.appendChild(el('span', { class: 'verdict-icon' }, llm.overall_band != null ? String(llm.overall_band) : '✓'));
      verdict.appendChild(el('span', {}, `Band ${llm.overall_band ?? '—'} · ${passed ? '达标' : '继续打磨'}`));
      wrap.appendChild(verdict);

      const grid = el('div', { class: 'feedback-grid' });
      grid.appendChild(scoreCell('综合', overall));
      grid.appendChild(scoreCell('任务回应', llm.task_response));
      grid.appendChild(scoreCell('语法', llm.grammar));
      grid.appendChild(scoreCell('词汇丰富', llm.vocabulary_range));
      grid.appendChild(scoreCell('连贯', llm.coherence));
      wrap.appendChild(grid);

      // word usage
      if (Array.isArray(llm.words) && llm.words.length) {
        const wu = el('div', {});
        wu.appendChild(el('div', { class: 'small muted mb-3' }, '目标词使用情况：'));
        const usage = el('div', { class: 'word-usage' });
        for (const w of llm.words) {
          const cls = w.used ? 'used' : 'missed';
          usage.appendChild(el('span', { class: `pill ${cls}` }, `${w.word}`),
            );
          const pill = usage.lastChild;
          if (typeof w.score === 'number') {
            const s = el('span', { class: 'score' }, String(w.score));
            pill.appendChild(s);
          }
          if (w.feedback) pill.title = w.feedback;
        }
        wu.appendChild(usage);
        wrap.appendChild(wu);
      }

      if (llm.feedback) wrap.appendChild(el('div', { class: 'notes mt-4' }, llm.feedback));
      if (llm.errors?.length) {
        const errs = el('div', { class: 'word-usage' });
        for (const e of llm.errors) errs.appendChild(el('span', { class: 'pill missed' }, `⚠ ${e}`));
        wrap.appendChild(el('div', { class: 'mt-3' }, [el('div', { class: 'small muted' }, '具体问题：'), errs]));
      }
      if (llm.improved_paragraph) {
        const imp = el('div', { class: 'improved' });
        imp.appendChild(el('h4', {}, '改写示例'));
        imp.appendChild(el('div', { class: 'serif' }, llm.improved_paragraph));
        wrap.appendChild(imp);
      }

      // record per-word progress
      const wordMap = new Map(entries.map(e => [e.word.toLowerCase(), e]));
      for (const w of (llm.words || [])) {
        const ent = wordMap.get(w.word.toLowerCase());
        if (!ent) continue;
        recordAndAdvance({ entry: ent, mode: 'scene', isCorrect: w.used && (w.score || 0) >= 6, score: w.score || 0, sentence: paragraph, sceneId: scene.id });
      }
    }

    fb.appendChild(wrap);

    const ctrls = el('div', { class: 'row gap-2 mt-3' });
    const next = el('button', { class: 'btn accent' }, '下一场景 →');
    next.addEventListener('click', () => onAdvance('pass'));
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
