<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  summary: { type: Object, required: true },
  city: { type: String, default: '' },
  job: { type: String, default: '' },
});

const salaryRef = ref(null);
const eduRef = ref(null);
const scheduleRef = ref(null);
const expRef = ref(null);
const recencyRef = ref(null);
const charts = [];

function renderChart(el, option) {
  if (!el) return;
  const chart = echarts.init(el);
  chart.setOption(option);
  charts.push(chart);
}

function renderAll() {
  charts.splice(0).forEach((c) => c.dispose());
  const s = props.summary;
  if (!s) return;

  // 薪资
  const sal = s.salary || {};
  renderChart(salaryRef.value, {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: ['最高', '平均', '最低'], axisLabel: { fontSize: 12 } },
    yAxis: { type: 'value', name: 'K/月', nameTextStyle: { fontSize: 11 } },
    series: [
      {
        type: 'bar',
        data: [
          { value: sal.highest === '未知' ? null : sal.highest, itemStyle: { color: '#ef4444' } },
          { value: sal.average === '未知' ? null : sal.average, itemStyle: { color: '#2563eb' } },
          { value: sal.lowest === '未知' ? null : sal.lowest, itemStyle: { color: '#22c55e' } },
        ],
        barWidth: 40,
        label: { show: true, position: 'top' },
      },
    ],
  });

  // 学历分布
  const edu = s.education || {};
  renderChart(eduRef.value, {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: (edu.distribution || []).map((d) => d.name) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: (edu.distribution || []).map((d) => d.count), barWidth: 32, itemStyle: { color: '#2563eb' } }],
  });

  // 工作制度
  const ws = (s.workSchedule || []).filter((d) => d.count > 0);
  renderChart(scheduleRef.value, {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '45%'],
        data: ws.map((d, i) => ({ ...d, itemStyle: { color: ['#2563eb', '#f59e0b', '#ef4444', '#10b981', '#9ca3af'][i % 5] } })),
        label: { formatter: '{b}: {c}' },
      },
    ],
  });

  // 经验要求
  const exp = (s.experience || []).filter((d) => d.count > 0);
  renderChart(expRef.value, {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '45%'],
        data: exp.map((d, i) => ({ ...d, itemStyle: { color: ['#2563eb', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#06b6d4', '#9ca3af'][i % 7] } })),
        label: { formatter: '{b}: {c}' },
      },
    ],
  });

  // 发布时效
  const rec = (s.publishRecency || []).filter((d) => d.count > 0);
  renderChart(recencyRef.value, {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '45%'],
        data: rec.map((d, i) => ({ ...d, itemStyle: { color: ['#22c55e', '#f59e0b', '#ef4444', '#9ca3af'][i % 4] } })),
        label: { formatter: '{b}: {c}' },
      },
    ],
  });
}

onMounted(() => {
  renderAll();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  charts.splice(0).forEach((c) => c.dispose());
});

function handleResize() {
  charts.forEach((c) => c.resize());
}

watch(() => props.summary, renderAll);
</script>

<template>
  <section class="analysis">
    <h3>岗位市场分析（{{ city }} · {{ job }}）</h3>
    <p class="desc">基于本次获取到的 {{ summary.itemsCount }} 条职位信息统计，供市场行情参考。</p>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-title">薪资范围（{{ summary.salary.unit }}）</div>
        <div class="stat-row">
          <span>最高 <b>{{ summary.salary.highest }}</b></span>
          <span>平均 <b>{{ summary.salary.average }}</b></span>
          <span>最低 <b>{{ summary.salary.lowest }}</b></span>
        </div>
        <div class="stat-note">有效样本 {{ summary.salary.validCount }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">学历要求</div>
        <div class="stat-row">
          <span>最高 <b>{{ summary.education.highest }}</b></span>
          <span>平均 <b>{{ summary.education.average }}</b></span>
          <span>最低 <b>{{ summary.education.lowest }}</b></span>
        </div>
        <div class="stat-note">按博士 &gt; 硕士 &gt; 本科 &gt; 大专 &gt; 高中及以下排序；"学历不限"另计</div>
      </div>
    </div>

    <div class="charts">
      <div class="chart">
        <div class="chart-title">薪资水平（K/月）</div>
        <div ref="salaryRef" class="chart-body"></div>
      </div>
      <div class="chart">
        <div class="chart-title">学历要求分布</div>
        <div ref="eduRef" class="chart-body"></div>
      </div>
      <div class="chart">
        <div class="chart-title">工作制度分布</div>
        <div ref="scheduleRef" class="chart-body"></div>
      </div>
      <div class="chart">
        <div class="chart-title">经验要求分布</div>
        <div ref="expRef" class="chart-body"></div>
      </div>
      <div class="chart">
        <div class="chart-title">发布时效分布</div>
        <div ref="recencyRef" class="chart-body"></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.analysis {
  margin-top: 24px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px 24px;
}
.analysis h3 {
  margin: 0;
}
.desc {
  margin: 6px 0 16px;
  color: #6b7280;
  font-size: 13px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.stat-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 16px;
  background: #fafafa;
}
.stat-title {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 10px;
}
.stat-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 14px;
  color: #374151;
}
.stat-row b {
  font-size: 18px;
  color: #111827;
  margin-left: 4px;
}
.stat-note {
  margin-top: 8px;
  font-size: 12px;
  color: #9ca3af;
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}
.chart {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.chart-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}
.chart-body {
  width: 100%;
  height: 240px;
}
</style>
