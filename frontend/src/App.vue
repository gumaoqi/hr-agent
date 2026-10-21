<script setup>
import { ref } from 'vue';
import JobCensus from './components/JobCensus.vue';
import ResumeScreening from './components/ResumeScreening.vue';
import InterviewPrep from './components/InterviewPrep.vue';
import InterviewScore from './components/InterviewScore.vue';

const active = ref('census');
const tabs = [
  { id: 'census', label: '岗位普查' },
  { id: 'resume', label: '简历筛选' },
  { id: 'interview', label: '面试准备' },
  { id: 'score', label: '面试评分' },
];
</script>

<template>
  <header>
    <h1>HR-Agent · 人事智能体</h1>
    <p>为人事部同事提供岗位市场信息查询与简历筛选服务</p>
  </header>
  <nav class="tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="tab"
      :class="{ active: active === tab.id }"
      @click="active = tab.id"
    >
      {{ tab.label }}
    </button>
  </nav>
  <main>
    <JobCensus v-if="active === 'census'" />
    <ResumeScreening v-else-if="active === 'resume'" />
    <InterviewPrep v-else-if="active === 'interview'" />
    <InterviewScore v-else-if="active === 'score'" />
  </main>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 1px solid #e5e7eb;
}
.tab {
  border: none;
  background: none;
  padding: 10px 20px;
  font-size: 15px;
  color: #6b7280;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: #2563eb;
}
.tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}
</style>
