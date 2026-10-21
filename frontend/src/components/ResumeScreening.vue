<script setup>
import { ref, computed } from 'vue';
import { cities, groupCitiesByInitial } from '../data/cities.js';
import { API_BASE } from '../api.js';

const city = ref('');
const job = ref('');
const salary = ref('不限');
const education = ref('不限');
const other = ref('');
const files = ref([]);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const results = ref(null);
const preview = ref(null); // { file, url }

const cityGroups = computed(() => groupCitiesByInitial(cities));
const canConfirm = computed(() => city.value && job.value.trim());

const salaryOptions = ['不限', '1-10K', '10-20K', '20-30K', '30-50K', '50-100K'];
const educationOptions = ['不限', '大专', '本科', '硕士', '博士'];
const MAX_FILES = 20;

/** 把本次打分结果写入 localStorage（供"面试准备"选择，保留最近 20 条） */
function saveScreenedRecords(items) {
  try {
    const saved = JSON.parse(localStorage.getItem('hr-agent-screened-resumes') || '[]');
    const ts = Date.now();
    for (const it of items) {
      const rec = {
        fileName: it.fileName,
        name: it.name,
        score: it.score,
        job: job.value.trim(),
        city: city.value,
        time: ts,
      };
      const idx = saved.findIndex((r) => r.fileName === it.fileName);
      if (idx >= 0) saved[idx] = rec;
      else saved.push(rec);
    }
    saved.sort((a, b) => b.time - a.time);
    localStorage.setItem('hr-agent-screened-resumes', JSON.stringify(saved.slice(0, 20)));
  } catch {
    // localStorage 不可用时静默跳过
  }
}

function pickFiles(event) {
  error.value = '';
  notice.value = '';
  const picked = Array.from(event.target.files || []);
  const pdfs = picked.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const nonPdf = picked.length - pdfs.length;
  let next = [...files.value, ...pdfs];
  if (next.length > MAX_FILES) {
    notice.value = `一次最多上传 ${MAX_FILES} 个文件，已自动保留前 ${MAX_FILES} 个，其余已忽略`;
    next = next.slice(0, MAX_FILES);
  }
  files.value = next;
  if (nonPdf > 0) {
    error.value = `已忽略 ${nonPdf} 个非 PDF 文件（仅支持 PDF 格式）`;
  }
  event.target.value = '';
}

function removeFile(index) {
  files.value.splice(index, 1);
  error.value = '';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function startScreening() {
  error.value = '';
  notice.value = '';
  if (!canConfirm.value) {
    error.value = '请先选择城市并填写职位名称';
    return;
  }
  if (!files.value.length) {
    error.value = '请先上传简历（PDF，最多 20 个文件）';
    return;
  }
  loading.value = true;
  results.value = null;
  const form = new FormData();
  form.append('city', city.value);
  form.append('job', job.value.trim());
  form.append('salary', salary.value);
  form.append('education', education.value);
  form.append('other', other.value.trim());
  files.value.forEach((f) => form.append('resumes', f));
  try {
    const resp = await fetch(`${API_BASE}/api/resume-screening`, { method: 'POST', body: form });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    }
    results.value = data.items || [];
    if (!results.value.length) {
      error.value = '未返回分析结果，请重试';
    } else {
      saveScreenedRecords(results.value);
    }
  } catch (e) {
    error.value = e.message || '筛选失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function openPreview(item) {
  const file = files.value.find((f) => f.name === item.fileName);
  if (!file) return;
  preview.value = { file, url: URL.createObjectURL(file) };
}

function closePreview() {
  if (preview.value) {
    URL.revokeObjectURL(preview.value.url);
    preview.value = null;
  }
}
</script>

<template>
  <section class="screening">
    <h2>简历筛选</h2>
    <p class="desc">填写岗位筛选条件，批量上传 PDF 简历，由大模型逐份评估（真实性、缺点、亮点、综合评分）并按评分排序。</p>

    <div class="form">
      <div class="field">
        <label for="rs-city">城市</label>
        <select id="rs-city" v-model="city">
          <option value="" disabled>请选择城市</option>
          <optgroup v-for="group in cityGroups" :key="group.letter" :label="group.letter">
            <option v-for="c in group.items" :key="c.name" :value="c.name">{{ c.name }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label for="rs-job">职位名称</label>
        <input id="rs-job" v-model="job" type="text" placeholder="例如：Java开发工程师" />
      </div>
      <div class="field">
        <label for="rs-salary">薪资（K/月）</label>
        <select id="rs-salary" v-model="salary">
          <option v-for="s in salaryOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="field">
        <label for="rs-edu">学历</label>
        <select id="rs-edu" v-model="education">
          <option v-for="e in educationOptions" :key="e" :value="e">{{ e }}</option>
        </select>
      </div>
      <div class="field field-other">
        <label for="rs-other">其他要求（可空）</label>
        <input id="rs-other" v-model="other" type="text" placeholder="例如：3年以上经验、熟悉Spring Cloud、可接受出差" />
      </div>
      <button class="confirm" :disabled="loading" @click="startScreening">
        {{ loading ? '筛选分析中…' : '确定' }}
      </button>
    </div>

    <div class="upload">
      <label class="upload-btn">
        <input type="file" accept=".pdf,application/pdf" multiple @change="pickFiles" />
        选择 PDF 简历（最多 20 个）
      </label>
      <span class="upload-tip">支持多选；一次最多 {{ MAX_FILES }} 个文件</span>
    </div>

    <div v-if="files.length" class="file-list">
      <div v-for="(f, i) in files" :key="i" class="file-item">
        <span class="file-name">{{ f.name }}</span>
        <span class="file-size">{{ formatSize(f.size) }}</span>
        <button class="remove" @click="removeFile(i)">移除</button>
      </div>
    </div>

    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="loading" class="loading">正在逐份分析 {{ files.length }} 份简历，请稍候（约需 1-2 分钟）…</div>

    <div v-if="results && results.length" class="result">
      <div class="result-head">
        <h3>筛选结果（按综合评分从高到低）</h3>
        <span class="meta">共 {{ results.length }} 份简历</span>
      </div>
      <ol class="ranking">
        <li v-for="(item, index) in results" :key="item.fileName + index" class="rank-item">
          <div class="rank-head">
            <span class="rank-no">{{ index + 1 }}</span>
            <span class="rank-name">{{ item.name }}</span>
            <span class="rank-score" :class="{ low: item.score !== null && item.score < 60, na: item.score === null }">
              {{ item.score === null ? '无法评分' : item.score + ' 分' }}
            </span>
            <button class="preview-btn" @click="openPreview(item)">预览简历</button>
          </div>
          <div class="rank-body">
            <div class="blk">
              <div class="blk-title bad">真实性</div>
              <div class="blk-text">{{ item.authenticity }}</div>
            </div>
            <div class="blk">
              <div class="blk-title warn">缺点 / 不满足点</div>
              <div class="blk-text">{{ item.weaknesses }}</div>
            </div>
            <div class="blk">
              <div class="blk-title good">亮点</div>
              <div class="blk-text">{{ item.highlights }}</div>
            </div>
          </div>
        </li>
      </ol>
    </div>

    <div v-if="preview" class="preview-mask" @click.self="closePreview">
      <div class="preview-box">
        <div class="preview-head">
          <span>简历预览：{{ preview.file.name }}</span>
          <button @click="closePreview">关闭</button>
        </div>
        <iframe :src="preview.url" class="preview-frame"></iframe>
      </div>
    </div>
  </section>
</template>

<style scoped>
.screening {
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
.form {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 14px;
  color: #374151;
  font-weight: 600;
}
.field input,
.field select {
  min-width: 180px;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.field input:focus,
.field select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
.field-other {
  flex: 1;
}
.field-other input {
  width: 100%;
  min-width: 260px;
}
.confirm {
  padding: 10px 28px;
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.confirm:hover {
  background: #1d4ed8;
}
.confirm:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.upload {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.upload-btn {
  display: inline-block;
  padding: 10px 18px;
  border: 1px dashed #2563eb;
  border-radius: 8px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 14px;
  cursor: pointer;
}
.upload-btn:hover {
  background: #dbeafe;
}
.upload-btn input {
  display: none;
}
.upload-tip {
  font-size: 12px;
  color: #9ca3af;
}
.file-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
}
.file-name {
  font-size: 14px;
  flex: 1;
  word-break: break-all;
}
.file-size {
  font-size: 12px;
  color: #9ca3af;
}
.remove {
  border: none;
  background: none;
  color: #dc2626;
  cursor: pointer;
  font-size: 13px;
}
.notice {
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
  border-radius: 8px;
  font-size: 13px;
}
.error {
  margin-top: 16px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 12px;
}
.loading {
  margin-top: 20px;
  color: #2563eb;
}
.result {
  margin-top: 24px;
}
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}
.result-head h3 {
  margin: 0;
}
.meta {
  font-size: 12px;
  color: #6b7280;
}
.ranking {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rank-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 16px;
  background: #fff;
}
.rank-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.rank-no {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.rank-name {
  font-size: 16px;
  font-weight: 600;
}
.rank-score {
  margin-left: auto;
  font-size: 15px;
  font-weight: 700;
  color: #16a34a;
}
.rank-score.low {
  color: #dc2626;
}
.rank-score.na {
  color: #9ca3af;
}
.preview-btn {
  border: 1px solid #2563eb;
  background: #fff;
  color: #2563eb;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.preview-btn:hover {
  background: #eff6ff;
}
.rank-body {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.blk {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fafafa;
}
.blk-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.blk-title.bad {
  color: #dc2626;
}
.blk-title.warn {
  color: #d97706;
}
.blk-title.good {
  color: #16a34a;
}
.blk-text {
  font-size: 13px;
  color: #374151;
  line-height: 1.6;
  white-space: pre-wrap;
}
.preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.preview-box {
  background: #fff;
  border-radius: 10px;
  width: min(900px, 92vw);
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
  font-weight: 600;
}
.preview-head button {
  border: none;
  background: #f3f4f6;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
}
.preview-frame {
  flex: 1;
  border: none;
  width: 100%;
}
</style>
