<script setup>
import { ref, computed } from 'vue';
import { cities, groupCitiesByInitial } from '../data/cities.js';
import { census } from '../api.js';
import AnalysisPanel from './AnalysisPanel.vue';

const job = ref('');
const city = ref('');
const loading = ref(false);
const error = ref('');
const result = ref(null);

const cityGroups = computed(() => groupCitiesByInitial(cities));

const canSubmit = computed(() => job.value.trim() && city.value);

const analysisSummary = computed(() =>
  result.value && result.value.summary
    ? { ...result.value.summary, itemsCount: (result.value.items || []).length }
    : null
);

async function onConfirm() {
  if (!canSubmit.value) {
    error.value = '请填写岗位名称并选择城市';
    return;
  }
  loading.value = true;
  error.value = '';
  result.value = null;
  try {
    const data = await census(job.value.trim(), city.value);
    result.value = data;
    if (!data.items || data.items.length === 0) {
      error.value = '未获取到招聘信息，请稍后重试';
    }
  } catch (e) {
    error.value = e.message || '查询失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="census">
    <h2>岗位普查</h2>
    <p class="desc">输入岗位名称并选择城市，快速了解该岗位在该城市的市场招聘情况（基于 BOSS 直聘最新发布的 10 条信息）。</p>

    <div class="form">
      <div class="field">
        <label for="job-input">岗位名称</label>
        <input
          id="job-input"
          v-model="job"
          type="text"
          placeholder="例如：Java开发工程师、产品经理"
          @keyup.enter="onConfirm"
        />
      </div>
      <div class="field">
        <label for="city-select">城市</label>
        <select id="city-select" v-model="city">
          <option value="" disabled>请选择城市</option>
          <optgroup v-for="group in cityGroups" :key="group.letter" :label="group.letter">
            <option v-for="c in group.items" :key="c.name" :value="c.name">{{ c.name }}</option>
          </optgroup>
        </select>
      </div>
      <button class="confirm" :disabled="loading" @click="onConfirm">
        {{ loading ? '查询中…' : '确认' }}
      </button>
    </div>

    <div v-if="loading" class="loading">正在搜索该岗位的最新招聘信息，请稍候…</div>
    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="result && result.items && result.items.length" class="result">
      <div class="result-head">
        <h3>{{ city }} · {{ job.trim() }} 招聘信息</h3>
        <span class="meta">共搜索到 {{ result.total }} 条相关结果，BOSS 直聘 {{ result.bossCount }} 条</span>
      </div>
      <AnalysisPanel v-if="analysisSummary" :summary="analysisSummary" :city="city" :job="job.trim()" />
      <div v-if="result.notice" class="notice">{{ result.notice }}</div>
      <div v-else-if="result.items.length < 10" class="notice">
        本次仅获取到 {{ result.items.length }} 条匹配的公开信息。BOSS 直聘职位详情页受登录与页面渲染限制，公开搜索可获取的信息有限，建议结合 BOSS 直聘官网查看完整职位列表。
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>岗位名称</th>
            <th>公司</th>
            <th>薪资</th>
            <th>发布时间</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in result.items" :key="index">
            <td>{{ index + 1 }}</td>
            <td>{{ item.job || '未知' }}</td>
            <td>{{ item.company || '未知' }}</td>
            <td>{{ item.salary || '未知' }}</td>
            <td>{{ item.publishDate || '未知' }}</td>
            <td>
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noopener noreferrer">
                {{ item.sourceSite || '查看原文' }}
              </a>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.census {
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
  min-width: 220px;
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
.loading {
  margin-top: 20px;
  color: #2563eb;
}
.error {
  margin-top: 20px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 12px;
}
.result {
  margin-top: 24px;
}
.result-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}
.result-head h3 {
  margin: 0;
}
.meta {
  font-size: 12px;
  color: #6b7280;
}
.notice {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th,
td {
  border: 1px solid #e5e7eb;
  padding: 10px 12px;
  text-align: left;
}
th {
  background: #f9fafb;
  color: #374151;
  font-weight: 600;
}
tbody tr:nth-child(even) {
  background: #f9fafb;
}
tbody tr:hover {
  background: #eff6ff;
}
a {
  color: #2563eb;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
</style>
