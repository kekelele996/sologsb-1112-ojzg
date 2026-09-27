<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useRingStore, type RecheckInput } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import { BIRD_AGES, RING_STATUSES, STATUS_COLOR, type BirdAge, type RingRecord, type RingStatus } from '../types/ring-record';
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const form = ref<RingForm>({
  ringNo: 'A-',
  colorRing: '无',
  speciesCn: '',
  speciesSci: '',
  age: '成',
  ringDate: today(),
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

/* ---------------- 复核登记（重捕 / 回收） ---------------- */

const recheckVisible = ref(false);
const recheckFormRef = ref<FormInstance>();
/** 调档结果：'' 未调档 / 'found' 命中 / 'missing' 查无此环 */
const lookupState = ref<'' | 'found' | 'missing'>('');
/** 命中的原档案（同一环号时间最早的一条） */
const originalRecord = ref<RingRecord | null>(null);

interface RecheckForm {
  ringNo: string;
  status: Exclude<RingStatus, '初捕'>;
  /** 现场判定鸟种 */
  observedCn: string;
  observedSci: string;
  /** 现场彩环（调档后带出原彩环，可按现场修正） */
  colorRing: string;
  ringDate: string;
  netNo: string;
  netRound: number;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark: string;
}

const recheckForm = reactive<RecheckForm>({
  ringNo: '',
  status: '重捕',
  observedCn: '',
  observedSci: '',
  colorRing: '无',
  ringDate: today(),
  netNo: '1 号网',
  netRound: 1,
  ringer: '',
  siteId: '',
  sessionId: '',
  remark: '',
});

const recheckRules: FormRules = {
  ringNo: [{ required: true, message: '请输入旧环号后调档', trigger: 'blur' }],
  observedCn: [{ required: true, message: '请选择现场判定鸟种以完成复核', trigger: 'change' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
  siteId: [{ required: true, message: '请选择鸟点', trigger: 'change' }],
  sessionId: [{ required: true, message: '请选择调查批次', trigger: 'change' }],
  netNo: [{ required: true, message: '请输入网号', trigger: 'blur' }],
};

/** 现场鸟种与原档案是否吻合（大小写 / 首尾空白不敏感） */
const speciesMatched = computed(
  () =>
    !!originalRecord.value &&
    recheckForm.observedCn.trim().toLowerCase() === originalRecord.value.speciesCn.trim().toLowerCase(),
);

const recheckHistory = computed(() => (originalRecord.value ? ringStore.historyOf(recheckForm.ringNo) : []));

function defaultSessionId(): string {
  return sessionStore.openSessions[0]?.id ?? sessionStore.sessions[0]?.id ?? '';
}

function resetRecheckForm() {
  Object.assign(recheckForm, {
    ringNo: '',
    status: '重捕',
    observedCn: '',
    observedSci: '',
    colorRing: '无',
    ringDate: today(),
    netNo: '1 号网',
    netRound: 1,
    ringer: '',
    siteId: siteStore.sites[0]?.id ?? '',
    sessionId: defaultSessionId(),
    remark: '',
  });
  lookupState.value = '';
  originalRecord.value = null;
}

/** 打开复核登记弹窗；prefillRingNo 用于初捕查重命中后一键转入 */
function openRecheck(prefillRingNo = '') {
  resetRecheckForm();
  recheckFormRef.value?.clearValidate();
  if (prefillRingNo) {
    recheckForm.ringNo = prefillRingNo;
    lookupRing();
  }
  recheckVisible.value = true;
}

/** 环号一旦手工改动，作废上一次调档结果，防止凭旧档案误提 */
watch(
  () => recheckForm.ringNo,
  (next, prev) => {
    if (lookupState.value !== '' && next.trim().toLowerCase() !== prev.trim().toLowerCase()) {
      lookupState.value = '';
      originalRecord.value = null;
    }
  },
);

/** 输入旧环号调档：带出原鸟种与彩环 */
function lookupRing() {
  const ringNo = recheckForm.ringNo.trim();
  if (!ringNo) {
    ElMessage.warning('请先输入旧环号');
    return;
  }
  const history = ringStore.historyOf(ringNo);
  if (history.length === 0) {
    lookupState.value = 'missing';
    originalRecord.value = null;
    return;
  }
  recheckForm.ringNo = history[0].ringNo;
  originalRecord.value = history[0];
  lookupState.value = 'found';
  // 带出原彩环（现场可修正）；现场鸟种留给复核人重新判定，不自动代填
  recheckForm.colorRing = history[0].colorRing || '无';
}

/** 一键确认现场鸟种与原档案一致 */
function confirmSameSpecies() {
  if (!originalRecord.value) return;
  recheckForm.observedCn = originalRecord.value.speciesCn;
  recheckForm.observedSci = originalRecord.value.speciesSci;
}

async function submitRecheck() {
  const ok = await recheckFormRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (!originalRecord.value) {
    ElMessage.error('请先输入旧环号并成功调档');
    return;
  }
  if (!speciesMatched.value) {
    // 双保险：弹窗按钮已禁用，这里再拦一次，绝不写入
    ElMessage.error('现场鸟种与原档案不吻合，已停止登记（原档案保持不变）');
    return;
  }
  const payload: RecheckInput = {
    ringNo: recheckForm.ringNo.trim(),
    colorRing: recheckForm.colorRing,
    status: recheckForm.status,
    ringDate: new Date(`${recheckForm.ringDate}T08:00:00`).toISOString(),
    netNo: recheckForm.netNo,
    netRound: Number(recheckForm.netRound) || 1,
    ringer: recheckForm.ringer,
    siteId: recheckForm.siteId,
    sessionId: recheckForm.sessionId,
    remark: recheckForm.remark,
  };
  const result = await ringStore.recheckRing(payload, {
    speciesCn: recheckForm.observedCn,
    speciesSci: recheckForm.observedSci,
  });
  if (result.outcome === 'added') {
    ElMessage.success(`已登记${result.record.status}事件 ${result.record.ringNo}（${result.record.speciesCn}），原档案未改动`);
    historyRingNo.value = result.record.ringNo;
    recheckVisible.value = false;
    historyVisible.value = true;
  } else if (result.outcome === 'missing') {
    lookupState.value = 'missing';
    ElMessage.error(`查无环号 ${payload.ringNo} 的档案，无法复核登记`);
  } else {
    ElMessage.error(
      `现场鸟种「${result.observedSpeciesCn}」与原档案鸟种「${result.original.speciesCn}」不吻合，已停止登记`,
    );
  }
}

/* ---------------- 初捕登记 / 编辑 ---------------- */

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
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
    ringDate: today(),
    netNo: '1 号网',
    netRound: 1,
    status: '初捕',
    ringer: '韩雪',
    siteId: siteStore.sites[0]?.id ?? '',
    sessionId: defaultSessionId(),
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
    ElMessage.error(`环号 ${form.value.ringNo} 已有档案，初捕不可重复登记，请走复核登记`);
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

/** 初捕查重命中后一键转入复核登记，并带上当前环号 */
function goRecheckFromCreate(ringNo: string) {
  dialogVisible.value = false;
  openRecheck(ringNo);
}

function showHistory(ringNo: string) {
  historyRingNo.value = ringNo;
  historyVisible.value = true;
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
const historyHeader = computed(() => historyRows.value[0]);
const siteNameOf = (siteId: string) => siteStore.siteName(siteId);
const sessionNoOf = (sessionId: string) => sessionStore.byId(sessionId)?.sessionNo ?? '—';
</script>

<template>
  <div>
    <h2 class="page-title">环志记录录入与检索</h2>
    <p class="page-desc">初捕走「登记环志记录」；现场重捕 / 回收走「复核登记」：输入旧环号调出原鸟种与彩环，鸟种吻合才追加本次事件，不吻合说明原因并停止，原档案不会被覆盖。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记环志记录</el-button>
      <el-button type="warning" @click="openRecheck()">复核登记（重捕 / 回收）</el-button>
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

    <!-- 初捕登记 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑环志记录' : '登记环志记录（初捕）'" width="760px">
      <RingCodeInput
        v-model:ring-no="form.ringNo"
        v-model:color-ring="form.colorRing"
        :existed="existedRecord"
        :history-count="existedHistory.length"
        @view-history="showHistory"
        @recheck="goRecheckFromCreate"
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
          <el-select v-model="form.status" style="width: 160px" :disabled="!editingId">
            <el-option v-for="status in RING_STATUSES" :key="status" :label="status" :value="status" />
          </el-select>
          <span v-if="!editingId" class="field-hint">新环一律初捕；重捕 / 回收请用「复核登记」</span>
        </el-form-item>
        <el-form-item label="环志人" prop="ringer">
          <el-input v-model="form.ringer" style="width: 160px" maxlength="16" placeholder="如：韩雪" />
        </el-form-item>
        <el-form-item label="鸟点">
          <el-select v-model="form.siteId" style="width: 240px">
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

    <!-- 复核登记（重捕 / 回收） -->
    <el-dialog v-model="recheckVisible" title="复核登记（重捕 / 回收）" width="720px">
      <el-form ref="recheckFormRef" :model="recheckForm" :rules="recheckRules" label-width="110px">
        <el-form-item label="旧环号" prop="ringNo">
          <el-input v-model="recheckForm.ringNo" placeholder="输入金属旧环号，如 A-10231" maxlength="20" style="width: 220px" @keyup.enter="lookupRing" />
          <el-button type="primary" plain style="margin-left: 8px" @click="lookupRing">调档</el-button>
          <el-radio-group v-model="recheckForm.status" style="margin-left: 12px">
            <el-radio-button value="重捕">重捕</el-radio-button>
            <el-radio-button value="回收">回收</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-alert
          v-if="lookupState === 'missing'"
          type="error"
          show-icon
          :closable="false"
          class="recheck-alert"
          :title="`查无环号 ${recheckForm.ringNo} 的本站档案`"
          description="无法复核登记：请核对环号识读；若确为其他站环志个体且本站从无记录，请先按外站回收新档流程联系管理员，不要在此强行登记。"
        />

        <template v-else-if="originalRecord">
          <el-descriptions :column="2" border size="small" class="recheck-alert">
            <el-descriptions-item label="原档案鸟种">
              {{ originalRecord.speciesCn }}（{{ originalRecord.speciesSci || '学名未记' }}）
            </el-descriptions-item>
            <el-descriptions-item label="原档案彩环">{{ originalRecord.colorRing || '无' }}</el-descriptions-item>
            <el-descriptions-item label="初捕日期">{{ formatDate(originalRecord.ringDate) }}</el-descriptions-item>
            <el-descriptions-item label="初捕鸟点 / 网号">
              {{ siteNameOf(originalRecord.siteId) }} · {{ originalRecord.netNo }}
            </el-descriptions-item>
            <el-descriptions-item label="历史事件数" :span="2">{{ recheckHistory.length }} 条（含本次调档前的全部经历）</el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">现场复核</el-divider>

          <el-form-item label="现场判定鸟种" prop="observedCn">
            <SpeciesPicker
              :species-cn="recheckForm.observedCn"
              :species-sci="recheckForm.observedSci"
              @update:species-cn="recheckForm.observedCn = $event"
              @update:species-sci="recheckForm.observedSci = $event"
            />
            <el-button link type="primary" style="margin-left: 8px" @click="confirmSameSpecies">与原档案一致</el-button>
          </el-form-item>

          <el-alert
            v-if="recheckForm.observedCn && !speciesMatched"
            type="error"
            show-icon
            :closable="false"
            class="recheck-alert"
            :title="`鸟种不吻合：现场为「${recheckForm.observedCn}」，原档案为「${originalRecord.speciesCn}」`"
            description="请核对环号是否读错（如 A-10231 / A-10237）、现场鸟种是否误判。登记已停止，原档案保持不变；确认无误后请改走相应处理流程。"
          />
          <el-alert
            v-else-if="speciesMatched"
            type="success"
            show-icon
            :closable="false"
            class="recheck-alert"
            :title="`鸟种吻合（${originalRecord.speciesCn}），可登记本次${recheckForm.status}事件`"
            description="本次只追加一条新事件，原档案的鸟种、彩环、日期等均不会被覆盖。"
          />

          <el-divider content-position="left">本次事件信息</el-divider>

          <el-form-item label="现场彩环">
            <el-input v-model="recheckForm.colorRing" style="width: 220px" maxlength="20" placeholder="已带出原彩环，可按现场修正" />
          </el-form-item>
          <el-form-item label="日期">
            <el-date-picker v-model="recheckForm.ringDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
          </el-form-item>
          <el-form-item label="鸟点" prop="siteId">
            <el-select v-model="recheckForm.siteId" style="width: 240px">
              <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="网号 / 网次" prop="netNo">
            <el-input v-model="recheckForm.netNo" style="width: 150px" maxlength="20" placeholder="如：6 号网" />
            <el-input-number v-model="recheckForm.netRound" :min="1" :max="20" style="margin-left: 8px" />
          </el-form-item>
          <el-form-item label="调查批次" prop="sessionId">
            <el-select v-model="recheckForm.sessionId" style="width: 240px">
              <el-option
                v-for="session in sessionStore.sessions"
                :key="session.id"
                :label="`${session.sessionNo} · ${session.date}${session.closed ? '（已关闭）' : ''}`"
                :value="session.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="环志人" prop="ringer">
            <el-input v-model="recheckForm.ringer" style="width: 160px" maxlength="16" placeholder="现场环志人" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="recheckForm.remark" type="textarea" :rows="2" maxlength="80" placeholder="与原档案彩环差异、位移距离、体况、回收情形等" />
          </el-form-item>
        </template>
      </el-form>

      <template #footer>
        <el-button @click="recheckVisible = false">取消</el-button>
        <el-button
          v-if="originalRecord && !speciesMatched"
          type="primary"
          disabled
          title="鸟种不吻合，已停止登记"
        >
          登记已停止
        </el-button>
        <el-button v-else type="primary" :disabled="!speciesMatched" @click="submitRecheck">
          登记{{ recheckForm.status }}事件
        </el-button>
      </template>
    </el-dialog>

    <!-- 同一只鸟的经历时间线 -->
    <el-dialog v-model="historyVisible" :title="`环号经历 · ${historyRingNo}`" width="720px">
      <div v-if="historyHeader" class="history-head">
        <el-tag type="info" effect="plain">{{ historyHeader.ringNo }}</el-tag>
        <span class="history-species">{{ historyHeader.speciesCn }}（{{ historyHeader.speciesSci || '学名未记' }}）</span>
        <span class="history-note">彩环：{{ historyHeader.colorRing || '无' }} · 共 {{ historyRows.length }} 次记录</span>
      </div>
      <el-empty v-if="historyRows.length === 0" description="暂无历史记录" :image-size="70" />
      <el-timeline v-else class="history-timeline">
        <el-timeline-item
          v-for="(row, index) in historyRows"
          :key="row.id"
          :type="row.status === '初捕' ? 'success' : row.status === '重捕' ? 'warning' : 'danger'"
          :timestamp="`${formatDate(row.ringDate)} · 第 ${index + 1} 次记录`"
          placement="top"
        >
          <div class="history-card">
            <div class="history-card-head">
              <el-tag :type="STATUS_COLOR[row.status]" size="small">{{ row.status }}</el-tag>
              <span class="history-site">{{ siteNameOf(row.siteId) }}</span>
              <span class="history-session">批次 {{ sessionNoOf(row.sessionId) }}</span>
            </div>
            <div class="history-card-body">
              彩环 {{ row.colorRing || '无' }} · {{ row.netNo }}（第 {{ row.netRound }} 网次）· 环志人 {{ row.ringer }}
            </div>
            <div v-if="row.remark" class="history-card-remark">备注：{{ row.remark }}</div>
          </div>
        </el-timeline-item>
      </el-timeline>
      <template #footer>
        <el-button type="primary" @click="historyVisible = false">关闭</el-button>
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
.field-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #8a99a5;
}
.recheck-alert {
  margin: 10px 0;
}
.history-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  font-size: 14px;
}
.history-species {
  font-weight: 600;
  color: #1f4a44;
}
.history-note {
  color: #8a99a5;
  font-size: 12px;
}
.history-timeline {
  margin-top: 16px;
  padding-left: 4px;
}
.history-card {
  background: #f7faf9;
  border: 1px solid #e3ede9;
  border-radius: 6px;
  padding: 8px 10px;
}
.history-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.history-site {
  font-weight: 600;
  color: #2f4a44;
  font-size: 13px;
}
.history-session {
  margin-left: auto;
  color: #8a99a5;
  font-size: 12px;
}
.history-card-body {
  font-size: 13px;
  color: #4a615c;
}
.history-card-remark {
  margin-top: 4px;
  font-size: 12px;
  color: #b07a2a;
}
</style>
