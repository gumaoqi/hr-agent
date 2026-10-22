<script setup>
import { ref, computed, watch } from 'vue';
import { API_BASE } from '../api.js';
import { uploadInterviewAudio } from '../supabase.js';

const records = ref([]);
const selectedFile = ref('');
const questionsDoc = ref(null);
const audioFile = ref(null);
const transcriptFile = ref(null);
const transcriptText = ref('');
const materialMode = ref(''); // 'audio' | 'file' | 'text'
const loading = ref(false);
const transcribing = ref(false); // 录音异步转写中（Netlify 场景：提交订单号后前端轮询）
const error = ref('');
const result = ref(null); // 后端返回：{ ai, name, job, city, transcript, ... }
const final = ref(null); // 手动调整后的最终评分

try {
  records.value = JSON.parse(localStorage.getItem('hr-agent-screened-resumes') || '[]');
  if (records.value.length) selectedFile.value = records.value[0].fileName;
} catch {
  records.value = [];
}

const DIM_LABELS = { professional: '专业能力', communication: '沟通表达', logic: '逻辑思维', match: '岗位匹配', quality: '综合素质' };
const DIM_ORDER = ['professional', 'communication', 'logic', 'match', 'quality'];

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function onQuestionsDoc(e) {
  const f = e.target.files?.[0];
  questionsDoc.value = f || null;
  error.value = '';
}
function onAudio(e) {
  const f = e.target.files?.[0];
  audioFile.value = f || null;
  error.value = '';
}
function onTranscriptFile(e) {
  const f = e.target.files?.[0];
  transcriptFile.value = f || null;
  error.value = '';
}

/** 评分请求：问题 Markdown 文档必传；录音 / 转写文本文件 / 粘贴文本三选一（有文本优先，后端自动跳过讯飞转写）
 * 录音路径：优先直传 Supabase Storage（Netlify 部署）→ 后端提交讯飞异步转写 → 前端轮询查询；
 * 未配置 Supabase 时回退本地直传后端同步转写（自托管模式）
 */
async function startScore() {
  error.value = '';
  if (!selectedFile.value) {
    error.value = '请选择一份简历';
    return;
  }
  if (!questionsDoc.value) {
    error.value = '请上传功能3导出的面试问题 Markdown 文档';
    return;
  }
  if (materialMode.value === 'audio' && !audioFile.value) {
    error.value = '请上传面试录音';
    return;
  }
  if (materialMode.value === 'file' && !transcriptFile.value) {
    error.value = '请上传转写文本文件';
    return;
  }
  if (materialMode.value === 'text' && !transcriptText.value.trim()) {
    error.value = '请粘贴转录文本';
    return;
  }
  if (!audioFile.value && !transcriptFile.value && !transcriptText.value.trim()) {
    error.value = '请选择并上传面试录音、转写文本文件，或粘贴转录文本';
    return;
  }
  loading.value = true;
  transcribing.value = false;
  result.value = null;
  final.value = null;
  const fd = new FormData();
  fd.append('resumeFileName', selectedFile.value);
  fd.append('questionsDoc', questionsDoc.value);
  if (transcriptFile.value) fd.append('transcriptFile', transcriptFile.value);
  if (transcriptText.value.trim()) fd.append('transcript', transcriptText.value.trim());
  try {
    // 录音：优先直传 Supabase Storage 拿公共 URL（Netlify 场景）；未配置则回退上传音频二进制（本地同步转写）
    if (audioFile.value) {
      let audioUrl = null;
      try {
        audioUrl = await uploadInterviewAudio(audioFile.value);
      } catch (e) {
        if (e.message === 'SUPABASE_NOT_CONFIGURED') {
          fd.append('audio', audioFile.value);
        } else {
          throw e;
        }
      }
      if (audioUrl) fd.append('audioUrl', audioUrl);
      if (audioUrl) fd.append('audioSize', String(audioFile.value.size));
    }
    const resp = await fetch(`${API_BASE}/api/interview-score`, { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    }
    // 异步转写：提交成功返回 pending + orderId，前端每 5 秒轮询查询（最长约 3 分钟）
    if (data.pending) {
      transcribing.value = true;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const qr = await fetch(`${API_BASE}/api/interview-score-query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderId }),
        });
        const q = await qr.json();
        if (!qr.ok) {
          throw new Error(q.error || `查询失败（HTTP ${qr.status}）`);
        }
        if (!q.pending) {
          data = q;
          break;
        }
      }
      transcribing.value = false;
      if (data.pending) {
        throw new Error('录音转写超时（约 3 分钟内未完成），请稍后重试或改用转录文本');
      }
    }
    result.value = data;
    // 预填手动调整区（以 AI 评分为基础）
    final.value = {
      totalScore: data.ai.totalScore,
      dimensions: { ...data.ai.dimensions },
      strengths: data.ai.strengths,
      weaknesses: data.ai.weaknesses,
      performance: data.ai.performance,
      suggestion: data.ai.suggestion,
      comment: '',
    };
  } catch (e) {
    error.value = e.message || '评分失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

async function exportMd() {
  error.value = '';
  if (!result.value || !final.value) {
    error.value = '请先完成 AI 评分';
    return;
  }
  loading.value = true;
  try {
    const resp = await fetch(`${API_BASE}/api/score-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeFileName: result.value.resumeFileName,
        ai: result.value.ai,
        final: final.value,
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `请求失败（HTTP ${resp.status}）`);
    }
    const text = await resp.text();
    const baseName = result.value.resumeFileName.replace(/\.[^.]+$/, '');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}-面试评分.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e.message || 'Markdown 生成失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="score">
    <h2>面试评分</h2>
    <p class="desc">
      选择功能2打分的简历、上传功能3导出的问题 Markdown 文档，并任选其一：上传面试录音（自动经讯飞转写）、
      上传转写文本文件（.txt/.md/.docx）或直接粘贴转录文本；由大模型对候选人面试表现进行 AI 评分与分析，
      可手动调整打分与评价后导出结果 Markdown。
    </p>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="panel">
      <h3>① 选择简历</h3>
      <select v-model="selectedFile" class="select">
        <option v-if="!records.length" value="" disabled>暂无打分记录，请先在「简历筛选」中上传打分</option>
        <option v-for="r in records" :key="r.fileName" :value="r.fileName">
          {{ r.name }}（{{ r.score === null ? '无法评分' : r.score + '分' }}）· {{ r.job }} · {{ r.city }} · {{ formatTime(r.time) }}
        </option>
      </select>
    </div>

    <div class="panel">
      <h3>② 面试材料</h3>
      <div class="row">
        <label class="file-label">
          问题 Markdown（功能3导出的"预提问"文档）
          <input type="file" accept=".md,.txt,.docx,text/markdown,text/plain" @change="onQuestionsDoc" />
        </label>
        <span v-if="questionsDoc" class="ok">已选择：{{ questionsDoc.name }}</span>
      </div>
      <div class="row modes">
        <label class="mode"><input type="radio" value="audio" v-model="materialMode" /> 上传面试录音</label>
        <label class="mode"><input type="radio" value="file" v-model="materialMode" /> 上传转写文本文件</label>
        <label class="mode"><input type="radio" value="text" v-model="materialMode" /> 粘贴转录文本</label>
      </div>
      <div v-if="materialMode === 'audio'" class="row">
        <label class="file-label">
          面试录音（mp3/wav/m4a 等，≤50MB，自动讯飞转写）
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.opus,.flac,.ogg,.amr" @change="onAudio" />
        </label>
        <span v-if="audioFile" class="ok">已选择：{{ audioFile.name }}</span>
      </div>
      <div v-else-if="materialMode === 'file'" class="row">
        <label class="file-label">
          转写文本文件（.txt/.md/.docx，如讯飞导出的转写记录）
          <input type="file" accept=".txt,.md,.docx,.text" @change="onTranscriptFile" />
        </label>
        <span v-if="transcriptFile" class="ok">已选择：{{ transcriptFile.name }}</span>
      </div>
      <div v-else-if="materialMode === 'text'" class="row">
        <textarea v-model="transcriptText" class="ta" rows="5" placeholder="粘贴面试录音转写文本"></textarea>
      </div>
    </div>

    <button class="btn primary" :disabled="loading || transcribing" @click="startScore">
      {{ transcribing ? '录音转写中（约1-3分钟），请勿关闭页面…' : loading ? '评分中…' : '开始 AI 评分' }}
    </button>

    <div v-if="transcribing" class="error" style="background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe;">
      录音已上传，正在讯飞转写中（约 1-3 分钟），期间请保持页面打开；完成后自动评分。
    </div>

    <div v-if="result" class="result">
      <div class="panel">
        <h3>③ AI 评分结果（{{ result.name }} · {{ result.job }} · {{ result.city }}）</h3>
        <div class="total">
          <span class="total-score">{{ result.ai.totalScore ?? '—' }}</span>
          <span class="total-label">综合评分（AI）</span>
        </div>
        <div class="dims">
          <div v-for="d in DIM_ORDER" :key="d" class="dim">
            <span class="dim-label">{{ DIM_LABELS[d] }}</span>
            <div class="dim-bar">
              <div class="dim-fill" :style="{ width: (result.ai.dimensions[d] ?? 0) + '%' }"></div>
            </div>
            <span class="dim-score">{{ result.ai.dimensions[d] ?? '—' }}</span>
          </div>
        </div>
        <div class="ai-text">
          <p><b>优势：</b><span style="white-space: pre-line">{{ result.ai.strengths }}</span></p>
          <p><b>劣势：</b><span style="white-space: pre-line">{{ result.ai.weaknesses }}</span></p>
          <p><b>面试表现：</b><span style="white-space: pre-line">{{ result.ai.performance }}</span></p>
          <p><b>建议：</b><span style="white-space: pre-line">{{ result.ai.suggestion }}</span></p>
        </div>
      </div>

      <div v-if="final" class="panel">
        <h3>④ 手动调整（人工复核后导出）</h3>
        <div class="manual-grid">
          <label v-for="d in DIM_ORDER" :key="d" class="manual-dim">
            {{ DIM_LABELS[d] }}
            <input type="number" min="0" max="100" v-model.number="final.dimensions[d]" class="num" />
          </label>
          <label class="manual-dim">
            综合评分
            <input type="number" min="0" max="100" v-model.number="final.totalScore" class="num big" />
          </label>
        </div>
        <div class="manual-text">
          <label>优势<textarea v-model="final.strengths" class="ta" rows="2"></textarea></label>
          <label>劣势<textarea v-model="final.weaknesses" class="ta" rows="2"></textarea></label>
          <label>面试表现<textarea v-model="final.performance" class="ta" rows="2"></textarea></label>
          <label>建议<textarea v-model="final.suggestion" class="ta" rows="2"></textarea></label>
          <label>人工评价<textarea v-model="final.comment" class="ta" rows="2" placeholder="可填写 HR 的人工补充评价，导出到 PDF"></textarea></label>
        </div>
        <button class="btn primary" :disabled="loading" @click="exportMd">
          {{ loading ? '生成中…' : '导出评分 Markdown' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.score {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px;
}
.desc {
  color: #6b7280;
  margin: 8px 0 20px;
  line-height: 1.6;
}
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}
.panel h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.modes {
  padding-bottom: 4px;
}
.mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
}
.mode input {
  accent-color: #2563eb;
}
.file-label {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #374151;
}
.file-label input {
  font-size: 13px;
}
.ok {
  color: #059669;
  font-size: 13px;
}
.or {
  color: #9ca3af;
  font-size: 13px;
}
.ta {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}
.ta:focus {
  outline: none;
  border-color: #2563eb;
}
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.error {
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 16px;
}
.result {
  margin-top: 16px;
}
.total {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}
.total-score {
  font-size: 44px;
  font-weight: 700;
  color: #2563eb;
}
.total-label {
  font-size: 14px;
  color: #6b7280;
}
.dims {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}
.dim {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dim-label {
  width: 84px;
  font-size: 13px;
  color: #374151;
  flex-shrink: 0;
}
.dim-bar {
  flex: 1;
  height: 10px;
  background: #e5e7eb;
  border-radius: 5px;
  overflow: hidden;
}
.dim-fill {
  height: 100%;
  background: #2563eb;
  border-radius: 5px;
  transition: width 0.4s;
}
.dim-score {
  width: 40px;
  text-align: right;
  font-size: 13px;
  color: #111827;
}
.ai-text p {
  margin: 6px 0;
  font-size: 13px;
  line-height: 1.7;
  color: #374151;
}
.manual-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.manual-dim {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #374151;
}
.num {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
}
.num.big {
  font-weight: 700;
  color: #2563eb;
}
.manual-text {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}
.manual-text label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #374151;
}
</style>
