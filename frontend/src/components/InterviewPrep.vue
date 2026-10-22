<script setup>
import { ref, computed, watch } from 'vue';
import { API_BASE } from '../api.js';

const QUEUE_KEY = 'hr-agent-interview-queue';

const records = ref([]);
const selectedFile = ref('');
const specialNeed = ref('');
const loading = ref(false);
const error = ref('');
const generated = ref(null); // { fileName, name, job, city, score, questions: [{q, intent}] }
const checked = ref([]);
const queue = ref({}); // { [fileName]: { name, items: [{q, intent}] } }

// ---------- 初始化 ----------
try {
  records.value = JSON.parse(localStorage.getItem('hr-agent-screened-resumes') || '[]');
  queue.value = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
  if (records.value.length && !selectedFile.value) {
    selectedFile.value = records.value[0].fileName;
  }
} catch {
  records.value = [];
  queue.value = {};
}

function persistQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.value));
}

const selectedRecord = computed(() =>
  records.value.find((r) => r.fileName === selectedFile.value) || null
);

const currentQueue = computed(() => {
  const q = queue.value[selectedFile.value];
  return q ? q.items : [];
});

watch(selectedFile, () => {
  checked.value = [];
});

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- 生成面试问题 ----------
async function generate() {
  error.value = '';
  if (!selectedFile.value) {
    error.value = '请先从最近打分的简历中选择一份';
    return;
  }
  loading.value = true;
  generated.value = null;
  checked.value = [];
  try {
    const resp = await fetch(`${API_BASE}/api/interview-prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: selectedFile.value, specialNeed: specialNeed.value.trim() }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    }
    generated.value = data;
  } catch (e) {
    error.value = e.message || '生成失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

const allChecked = computed(() =>
  generated.value && generated.value.questions.length && checked.value.length === generated.value.questions.length
);

function toggleAll() {
  if (!generated.value) return;
  checked.value = allChecked.value ? [] : generated.value.questions.map((_, i) => i);
}

function addCheckedToQueue() {
  if (!generated.value || !checked.value.length) {
    error.value = '请先勾选至少一个问题';
    return;
  }
  const entry = queue.value[selectedFile.value] || { name: generated.value.name || selectedFile.value, items: [] };
  const existingTexts = new Set(entry.items.map((x) => x.q));
  let added = 0;
  for (const i of checked.value) {
    const item = generated.value.questions[i];
    if (!item || existingTexts.has(item.q)) continue;
    entry.items.push({ q: item.q, intent: item.intent || '' });
    existingTexts.add(item.q);
    added += 1;
  }
  queue.value[selectedFile.value] = entry;
  persistQueue();
  error.value = '';
  if (added === 0) {
    error.value = '所选问题已在待询问列表中';
  }
  checked.value = [];
}

function removeFromQueue(index) {
  const entry = queue.value[selectedFile.value];
  if (!entry) return;
  entry.items.splice(index, 1);
  if (!entry.items.length) delete queue.value[selectedFile.value];
  persistQueue();
}

function clearQueue() {
  if (currentQueue.value.length && !window.confirm('确定清空当前简历的待询问列表吗？')) return;
  delete queue.value[selectedFile.value];
  persistQueue();
}

// ---------- 导出 Markdown 提问文档 ----------
async function downloadMd() {
  error.value = '';
  const qs = currentQueue.value;
  if (!selectedFile.value) {
    error.value = '请选择简历';
    return;
  }
  if (!qs.length) {
    error.value = '待询问列表为空，请先生成并添加面试问题';
    return;
  }
  loading.value = true;
  try {
    const resp = await fetch(`${API_BASE}/api/interview-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: selectedFile.value, questions: qs, specialNeed: specialNeed.value.trim() }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `请求失败（HTTP ${resp.status}）`);
    }
    const text = await resp.text();
    const baseName = selectedFile.value.replace(/\.[^.]+$/, '');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}-预提问.md`;
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
  <section class="interview">
    <h2>面试准备</h2>
    <p class="desc">从最近打分的简历中选择候选人，基于简历与特别需求生成面试问题，勾选加入待询问列表，最后导出 Markdown 提问文档。</p>

    <div class="layout">
      <div class="left">
        <div class="panel">
          <h3>① 选择简历</h3>
          <select v-model="selectedFile" class="select">
            <option v-if="!records.length" value="" disabled>暂无打分记录，请先在「简历筛选」中上传打分</option>
            <option v-for="r in records" :key="r.fileName" :value="r.fileName">
              {{ r.name }}（{{ r.score === null ? '无法评分' : r.score + '分' }}）· {{ r.job }} · {{ r.city }} · {{ formatTime(r.time) }}
            </option>
          </select>
          <div v-if="selectedRecord" class="rec-info">
            岗位：{{ selectedRecord.job }}（{{ selectedRecord.city }}）｜ 评分：{{ selectedRecord.score === null ? '无法评分' : selectedRecord.score }}
          </div>
        </div>

        <div class="panel">
          <h3>② 特别需求（可空）</h3>
          <input v-model="specialNeed" class="input" type="text" placeholder="例如：重点考察分布式系统设计能力、能否接受加班" />
          <button class="btn primary" :disabled="loading" @click="generate">
            {{ loading ? '生成中…' : '生成面试问题' }}
          </button>
        </div>

        <div v-if="error" class="error">{{ error }}</div>

        <div v-if="generated" class="panel">
          <h3>③ 生成的面试问题（{{ generated.questions.length }} 个）</h3>
          <p class="hint">勾选后点击「添加到待询问列表」；重新生成会替换下方问题集，已添加的问题保留。</p>
          <label class="all-check">
            <input type="checkbox" :checked="allChecked" @change="toggleAll" />
            全选
          </label>
          <div v-for="(q, i) in generated.questions" :key="i" class="q-item">
            <label>
              <input type="checkbox" :value="i" v-model="checked" />
              <span class="q-text">{{ i + 1 }}. {{ q.q }}</span>
            </label>
            <div class="q-intent" v-if="q.intent">考察意图：{{ q.intent }}</div>
          </div>
          <button class="btn primary" @click="addCheckedToQueue">添加到待询问列表（{{ checked.length }}）</button>
        </div>
      </div>

      <div class="right">
        <div class="panel">
          <h3>待询问列表（{{ currentQueue.length }}）</h3>
          <div v-if="!currentQueue.length" class="empty">尚未添加问题</div>
          <div v-for="(item, i) in currentQueue" :key="i" class="queue-item">
            <span class="q-no">{{ i + 1 }}</span>
            <div class="queue-body">
              <div class="q-text">{{ item.q }}</div>
              <div class="q-intent" v-if="item.intent">考察意图：{{ item.intent }}</div>
            </div>
            <button class="remove" @click="removeFromQueue(i)">移除</button>
          </div>
          <div class="queue-actions" v-if="currentQueue.length">
            <button class="btn danger" @click="clearQueue">清空列表</button>
            <button class="btn primary" :disabled="loading" @click="downloadMd">
              {{ loading ? '生成中…' : '生成待询问 Markdown' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.interview {
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
.layout {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.left,
.right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
}
.panel h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.select,
.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.select:focus,
.input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
.rec-info {
  margin-top: 10px;
  font-size: 13px;
  color: #6b7280;
}
.btn {
  margin-top: 12px;
  padding: 10px 20px;
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
.btn.danger {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.btn.danger:hover {
  background: #fee2e2;
}
.hint {
  font-size: 12px;
  color: #9ca3af;
  margin: 0 0 8px;
}
.all-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #374151;
  margin-bottom: 8px;
  cursor: pointer;
}
.q-item {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: #fafafa;
}
.q-item label {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
}
.q-text {
  font-size: 14px;
  color: #111827;
  line-height: 1.5;
}
.q-intent {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.5;
}
.error {
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.empty {
  color: #9ca3af;
  font-size: 13px;
  padding: 12px 0;
}
.queue-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.q-no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.queue-body {
  flex: 1;
}
.remove {
  border: none;
  background: none;
  color: #dc2626;
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
}
.queue-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}
.queue-actions .btn {
  margin-top: 0;
}
</style>
