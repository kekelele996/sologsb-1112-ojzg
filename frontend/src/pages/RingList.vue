<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useRingStore } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import {
  BIRD_AGES,
  RING_STATUSES,
  STATUS_COLOR,
  type BirdAge,
  type RingRecord,
  type RingStatus,
  type ReviewStatus,
} from '../types/ring-record';
import { formatDate } from '../utils/format';
import { speciesCount } from '../utils/stats';

const route = useRoute();
const ringStore = useRingStore();
const siteStore = useSiteStore();
const sessionStore = useSessionStore();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
const historyVisible = ref(false);
const historyRingNo = ref('');

/** 复核登记弹窗 */
const reviewVisible = ref(false);
const reviewRef = ref<FormInstance>();
const reviewRingNo = ref('');
const reviewOrigin = ref<RingRecord | null>(null);
const reviewMismatch = ref('');
const reviewStatus = ref<ReviewStatus>('重捕');

interface ReviewForm {
  observedCn: string;
  observedSci: string;
  ringDate: string;
  netNo: string;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark: string;
}

const reviewForm = ref<ReviewForm>({
  observedCn: '',
  observedSci: '',
  ringDate: new Date().toISOString().slice(0, 10),
  netNo: '',
  ringer: '',
  siteId: '',
  sessionId: '',
  remark: '',
});

const reviewRules: FormRules = {
  observedCn: [{ required: true, message: '请选择或输入现场辨认鸟种', trigger: 'change' }],
  ringDate: [{ required: true, message: '请选择本次事件日期', trigger: 'change' }],
  netNo: [{ required: true, message: '请输入网号', trigger: 'blur' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
  siteId: [{ required: true, message: '请选择鸟点', trigger: 'change' }],
  sessionId: [{ required: true, message: '请选择调查批次', trigger: 'change' }],
};

interface RingForm {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark: string;
}

const form = ref<RingForm>({
  ringNo: 'A-',
  colorRing: '无',
  speciesCn: '',
  speciesSci: '',
  age: '成',
  ringDate: new Date().toISOString().slice(0, 10),
  netNo: '1 号网',
  netRound: 1,
  status: '初捕',
  ringer: '',
  siteId: '',
  sessionId: '',
  remark: '',
});

const rules: FormRules = {
  ringNo: [{ required: true, message: '请输入金属环号', trigger: 'blur' }],
  speciesCn: [{ required: true, message: '请选择或输入鸟种中文名', trigger: 'change' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
};

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const sessionParam = computed(() => (typeof route.query.session === 'string' ? route.query.session : ''));
const sessionSelectParam = computed(() => (typeof route.query.sessionSelect === 'string' ? route.query.sessionSelect : ''));

const visible = computed(() => {
  const kw = kwParam.value.trim().toLowerCase();
  return ringStore.rings.filter((record) => {
    if (speciesParam.value && record.speciesCn !== speciesParam.value) return false;
    if (statusParam.value && record.status !== statusParam.value) return false;
    if (sessionSelectParam.value && record.sessionId !== sessionSelectParam.value) return false;
    if (kw) {
      const haystack = `${record.ringNo} ${record.colorRing} ${record.speciesCn} ${record.speciesSci} ${record.ringer} ${record.netNo}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
});

/** 环号查重：编辑时排除自身 */
const existedRecord = computed(() => {
  const found = ringStore.findByRingNo(form.value.ringNo);
  return found && found.id !== editingId.value ? found : undefined;
});
const existedHistory = computed(() => (existedRecord.value ? ringStore.historyOf(form.value.ringNo) : []));

const entityOptions = computed(() => speciesCount(ringStore.rings).map((item) => item.speciesCn));

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    ringNo: 'A-',
    colorRing: '无',
    speciesCn: '红喉歌鸲',
    speciesSci: 'Calliope calliope',
    age: '成',
    ringDate: new Date().toISOString().slice(0, 10),
    netNo: '1 号网',
    netRound: 1,
    status: '初捕',
    ringer: '韩雪',
    siteId: siteStore.sites[0]?.id ?? '',
    sessionId: sessionStore.sessions[0]?.id ?? '',
    remark: '',
  };
  dialogVisible.value = true;
}

function openEdit(record: RingRecord) {
  editingId.value = record.id;
  form.value = {
    ringNo: record.ringNo,
    colorRing: record.colorRing,
    speciesCn: record.speciesCn,
    speciesSci: record.speciesSci,
    age: record.age,
    ringDate: record.ringDate.slice(0, 10),
    netNo: record.netNo,
    netRound: record.netRound,
    status: record.status,
    ringer: record.ringer,
    siteId: record.siteId,
    sessionId: record.sessionId,
    remark: record.remark ?? '',
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (!editingId.value && existedRecord.value) {
    ringStore.setDuplicate(existedRecord.value.id);
    ElMessage.error(`环号 ${form.value.ringNo} 已存在，已跳转该环号历史记录`);
    historyRingNo.value = form.value.ringNo;
    historyVisible.value = true;
    return;
  }
  const payload = {
    ringNo: form.value.ringNo,
    colorRing: form.value.colorRing,
    speciesCn: form.value.speciesCn,
    speciesSci: form.value.speciesSci,
    age: form.value.age,
    ringDate: new Date(`${form.value.ringDate}T08:00:00`).toISOString(),
    netNo: form.value.netNo,
    netRound: Number(form.value.netRound) || 1,
    status: form.value.status,
    ringer: form.value.ringer,
    siteId: form.value.siteId,
    sessionId: form.value.sessionId,
    remark: form.value.remark,
  };
  if (editingId.value) {
    await ringStore.updateRing(editingId.value, payload);
    ElMessage.success(`已更新环志记录 ${payload.ringNo}`);
  } else {
    await ringStore.addRing(payload);
    ElMessage.success(`已登记环志记录 ${payload.ringNo}（${payload.speciesCn}）`);
  }
  dialogVisible.value = false;
}

function showHistory(ringNo: string) {
  historyRingNo.value = ringNo;
  historyVisible.value = true;
}

/** 从查重警告转入复核登记：先收起建档弹窗，避免两个弹窗叠放 */
function switchToReview(ringNo: string) {
  dialogVisible.value = false;
  openReview(ringNo);
}

/** 打开复核登记弹窗；可带环号直接查询（查重警告「转复核登记」入口） */
function openReview(ringNo = '') {
  reviewVisible.value = true;
  reviewOrigin.value = null;
  reviewMismatch.value = '';
  reviewStatus.value = '重捕';
  reviewRingNo.value = ringNo.trim();
  reviewRef.value?.clearValidate();
  const defaultSession = sessionStore.openSessions[0] ?? sessionStore.sessions[0];
  reviewForm.value = {
    observedCn: '',
    observedSci: '',
    ringDate: new Date().toISOString().slice(0, 10),
    netNo: '',
    ringer: '',
    siteId: defaultSession?.siteId ?? siteStore.sites[0]?.id ?? '',
    sessionId: defaultSession?.id ?? '',
    remark: '',
  };
  if (reviewRingNo.value) lookupReview();
}

/** 输入旧环号后带出原鸟种、彩环等原档案信息 */
function lookupReview() {
  const ringNo = reviewRingNo.value.trim();
  if (!ringNo) {
    ElMessage.warning('请先输入旧环号');
    return;
  }
  const origin = ringStore.originOf(ringNo);
  reviewMismatch.value = '';
  if (!origin) {
    reviewOrigin.value = null;
    ElMessage.error(`环号 ${ringNo} 查无原档案，请先在「登记环志记录」中初捕建档`);
    return;
  }
  reviewOrigin.value = origin;
  reviewRingNo.value = origin.ringNo;
  reviewForm.value.observedCn = origin.speciesCn;
  reviewForm.value.observedSci = origin.speciesSci;
  reviewForm.value.netNo = reviewForm.value.netNo || origin.netNo;
  reviewForm.value.ringer = reviewForm.value.ringer || origin.ringer;
  reviewRef.value?.clearValidate('observedCn');
}

// 现场鸟种一旦修改，即时提示与原档案是否吻合；不吻合时保存会被拦下
watch(
  () => reviewForm.value.observedCn,
  (value) => {
    if (!reviewOrigin.value) return;
    reviewMismatch.value =
      value.trim() && value.trim() !== reviewOrigin.value.speciesCn
        ? `现场鸟种「${value.trim()}」与原档案「${reviewOrigin.value.speciesCn}」不一致，原档案不会被覆盖；请核对环号或改回正确鸟种后再保存`
        : '';
  },
);

const reviewSpeciesMatch = computed(
  () => !!reviewOrigin.value && reviewForm.value.observedCn.trim() === reviewOrigin.value.speciesCn,
);

async function submitReview() {
  const ok = await reviewRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (!reviewOrigin.value) {
    ElMessage.error('请先输入旧环号并查询原档案');
    return;
  }
  if (!reviewSpeciesMatch.value) {
    reviewMismatch.value = `现场鸟种「${reviewForm.value.observedCn.trim()}」与原档案「${reviewOrigin.value.speciesCn}」不一致，已停止登记且未改动原档案，请核对环号 / 鸟种后再复核`;
    ElMessage.error('鸟种与原档案不吻合，已停止复核登记');
    return;
  }
  const result = await ringStore.addReviewEvent({
    ringNo: reviewOrigin.value.ringNo,
    observedSpecies: reviewForm.value.observedCn,
    ringDate: new Date(`${reviewForm.value.ringDate}T08:00:00`).toISOString(),
    netNo: reviewForm.value.netNo,
    status: reviewStatus.value,
    ringer: reviewForm.value.ringer,
    siteId: reviewForm.value.siteId,
    sessionId: reviewForm.value.sessionId,
    remark: reviewForm.value.remark,
  });
  if (result.reason || !result.record) {
    reviewMismatch.value = result.reason ?? '复核登记失败';
    ElMessage.error(reviewMismatch.value);
    return;
  }
  ElMessage.success(`已登记 ${result.record.ringNo}（${result.record.speciesCn}）${result.record.status}事件，原档案保留不变`);
  reviewVisible.value = false;
  showHistory(result.record.ringNo);
}

async function remove(record: RingRecord) {
  const confirmed = await ElMessageBox.confirm(`确认删除环志记录 ${record.ringNo}（${record.speciesCn}）？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await ringStore.removeRing(record.id);
  ElMessage.success('已删除');
}

const historyRows = computed(() => ringStore.historyOf(historyRingNo.value));
</script>

<template>
  <div>
    <h2 class="page-title">环志记录录入与检索</h2>
    <p class="page-desc">
      金属环号 + 彩环组合双段录入，自动查重；带环鸟重捕 / 回收请走「复核登记」：输入旧环号带出原鸟种与彩环，鸟种吻合才新增本次事件，不吻合说明原因并停下，原档案不被覆盖。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记环志记录</el-button>
      <el-button type="warning" plain @click="openReview()">复核登记（重捕 / 回收）</el-button>
      <el-tag v-if="ringStore.duplicate" type="warning" effect="plain">
        查重命中：{{ ringStore.duplicate.ringNo }}（{{ ringStore.duplicate.speciesCn }}）
      </el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'species', label: '鸟种', options: entityOptions, width: 140 },
        { key: 'status', label: '状态', options: [...RING_STATUSES], width: 110 },
        { key: 'sessionSelect', label: '调查批次', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索环号 / 鸟种 / 环志人 / 网号"
      :result-count="visible.length"
      :total-count="ringStore.rings.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的环志记录" action-text="登记环志记录" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column prop="ringNo" label="金属环号" width="110" />
        <el-table-column prop="colorRing" label="彩环" width="100" />
        <el-table-column prop="speciesCn" label="鸟种" width="110" />
        <el-table-column prop="speciesSci" label="学名" min-width="170" show-overflow-tooltip />
        <el-table-column prop="age" label="年龄" width="80" />
        <el-table-column label="环志日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column prop="netNo" label="网号" width="90" />
        <el-table-column prop="netRound" label="网次" width="70" align="right" />
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="90" />
        <el-table-column label="鸟点" width="140">
          <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="showHistory(scope.row.ringNo)">历史</el-button>
            <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑环志记录' : '登记环志记录'" width="760px">
      <RingCodeInput
        v-model:ring-no="form.ringNo"
        v-model:color-ring="form.colorRing"
        :existed="existedRecord"
        :history-count="existedHistory.length"
        @view-history="showHistory"
        @review="switchToReview"
      />

      <el-divider content-position="left">鸟种与环志信息</el-divider>

      <SpeciesPicker v-model:species-cn="form.speciesCn" v-model:species-sci="form.speciesSci" />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="ring-form">
        <el-form-item label="金属环号" prop="ringNo">
          <el-input v-model="form.ringNo" placeholder="如：A-10231" maxlength="20" />
        </el-form-item>
        <el-form-item label="鸟种中文名" prop="speciesCn">
          <el-input v-model="form.speciesCn" placeholder="与上方鸟种选择一致" maxlength="30" />
        </el-form-item>
        <el-form-item label="学名">
          <el-input v-model="form.speciesSci" maxlength="60" />
        </el-form-item>
        <el-form-item label="年龄">
          <el-select v-model="form.age" style="width: 160px">
            <el-option v-for="age in BIRD_AGES" :key="age" :label="age" :value="age" />
          </el-select>
        </el-form-item>
        <el-form-item label="环志日期">
          <el-date-picker v-model="form.ringDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="网号">
          <el-input v-model="form.netNo" style="width: 160px" maxlength="20" placeholder="如：3 号网" />
        </el-form-item>
        <el-form-item label="网次">
          <el-input-number v-model="form.netRound" :min="1" :max="20" placeholder="网次" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option v-for="status in RING_STATUSES" :key="status" :label="status" :value="status" />
          </el-select>
        </el-form-item>
        <el-form-item label="环志人" prop="ringer">
          <el-input v-model="form.ringer" style="width: 160px" maxlength="16" placeholder="如：韩雪" />
        </el-form-item>
        <el-form-item label="鸟点">
          <el-select v-model="form.siteId" style="width: 240px" :options="[]">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="调查批次">
          <el-select v-model="form.sessionId" style="width: 240px">
            <el-option v-for="session in sessionStore.sessions" :key="session.id" :label="`${session.sessionNo} · ${session.date}`" :value="session.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="80" placeholder="重捕位移、体况等" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="historyVisible" :title="`环号经历时间线 · ${historyRingNo}`" width="720px">
      <el-timeline v-if="historyRows.length">
        <el-timeline-item
          v-for="(row, index) in historyRows"
          :key="row.id"
          :type="row.status === '初捕' ? 'success' : row.status === '重捕' ? 'warning' : 'danger'"
          :timestamp="`${formatDate(row.ringDate)} · ${row.status}`"
          placement="top"
        >
          <el-card shadow="never" class="timeline-card">
            <div class="timeline-head">
              <el-tag :type="STATUS_COLOR[row.status]" size="small">{{ row.status }}</el-tag>
              <el-tag v-if="index === 0" size="small" type="info" effect="plain">原档案</el-tag>
              <span class="timeline-species">{{ row.speciesCn }}（{{ row.speciesSci }}）</span>
              <span class="timeline-color">彩环：{{ row.colorRing }}</span>
            </div>
            <div class="timeline-meta">
              <span>鸟点：{{ siteStore.siteName(row.siteId) }}</span>
              <span>网号：{{ row.netNo }}</span>
              <span>年龄：{{ row.age }}</span>
              <span>环志人：{{ row.ringer }}</span>
              <span>批次：{{ sessionStore.byId(row.sessionId)?.sessionNo ?? '—' }}</span>
            </div>
            <div v-if="row.remark" class="timeline-remark">备注：{{ row.remark }}</div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="该环号暂无历史记录" />
      <template #footer>
        <el-button @click="historyVisible = false">关闭</el-button>
        <el-button type="warning" plain @click="openReview(historyRingNo)">再登记一次重捕 / 回收</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reviewVisible" title="复核登记（带环鸟重捕 / 回收）" width="720px">
      <el-form label-width="110px">
        <el-form-item label="旧环号" required>
          <el-input v-model="reviewRingNo" placeholder="输入金属环号，如 A-10231" maxlength="20" style="width: 220px" @keyup.enter="lookupReview" />
          <el-button type="primary" plain style="margin-left: 8px" @click="lookupReview">查询原档案</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="!reviewOrigin"
        type="info"
        show-icon
        :closable="false"
        title="请先输入旧环号并查询，系统会带出该环号的原鸟种与彩环；复核登记只会新增本次事件，不会覆盖原档案。"
      />

      <template v-else>
        <el-descriptions title="原档案（只读，以最早记录为准）" :column="3" border size="small" class="review-origin">
          <el-descriptions-item label="金属环号">{{ reviewOrigin.ringNo }}</el-descriptions-item>
          <el-descriptions-item label="原鸟种">{{ reviewOrigin.speciesCn }}</el-descriptions-item>
          <el-descriptions-item label="彩环">{{ reviewOrigin.colorRing }}</el-descriptions-item>
          <el-descriptions-item label="学名">{{ reviewOrigin.speciesSci || '—' }}</el-descriptions-item>
          <el-descriptions-item label="初戴环年龄">{{ reviewOrigin.age }}</el-descriptions-item>
          <el-descriptions-item label="原档案日期">{{ formatDate(reviewOrigin.ringDate) }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">本次事件</el-divider>

        <el-form ref="reviewRef" :model="reviewForm" :rules="reviewRules" label-width="110px">
          <el-form-item label="事件类型">
            <el-radio-group v-model="reviewStatus">
              <el-radio-button label="重捕" value="重捕" />
              <el-radio-button label="回收" value="回收" />
            </el-radio-group>
          </el-form-item>
          <el-form-item label="现场鸟种" prop="observedCn">
            <SpeciesPicker v-model:species-cn="reviewForm.observedCn" v-model:species-sci="reviewForm.observedSci" />
          </el-form-item>
          <el-alert
            v-if="reviewMismatch"
            type="error"
            show-icon
            :closable="false"
            class="review-alert"
            :title="reviewMismatch"
          />
          <el-alert
            v-else
            type="success"
            show-icon
            :closable="false"
            class="review-alert"
            title="鸟种与原档案吻合，保存后将新增本次事件，原档案保持不变"
          />
          <el-form-item label="日期" prop="ringDate">
            <el-date-picker v-model="reviewForm.ringDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
          </el-form-item>
          <el-form-item label="鸟点" prop="siteId">
            <el-select v-model="reviewForm.siteId" style="width: 260px" placeholder="选择本次鸟点">
              <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="网号" prop="netNo">
            <el-input v-model="reviewForm.netNo" style="width: 200px" maxlength="20" placeholder="如：6 号网" />
          </el-form-item>
          <el-form-item label="环志人" prop="ringer">
            <el-input v-model="reviewForm.ringer" style="width: 200px" maxlength="16" placeholder="如：郑海" />
          </el-form-item>
          <el-form-item label="调查批次" prop="sessionId">
            <el-select v-model="reviewForm.sessionId" style="width: 260px" placeholder="选择所属批次">
              <el-option v-for="session in sessionStore.sessions" :key="session.id" :label="`${session.sessionNo} · ${session.date}`" :value="session.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="reviewForm.remark" type="textarea" :rows="2" maxlength="80" placeholder="重捕位移、回收来源、体况等" />
          </el-form-item>
        </el-form>
      </template>

      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!reviewSpeciesMatch" @click="submitReview">
          保存{{ reviewStatus }}事件
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.ring-form {
  margin-top: 10px;
}
.timeline-card {
  border-radius: 6px;
}
.timeline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.timeline-species {
  font-weight: 600;
  color: #1f4a44;
}
.timeline-color {
  color: #8a99a5;
  font-size: 12px;
}
.timeline-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 12px;
  color: #2f4a44;
}
.timeline-remark {
  margin-top: 6px;
  font-size: 12px;
  color: #b88230;
}
.review-origin {
  margin-top: 8px;
}
.review-alert {
  margin: 0 0 12px 110px;
}
</style>
