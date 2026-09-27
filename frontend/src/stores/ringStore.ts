import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { BirdAge, RingRecord, RingStatus } from '../types/ring-record';

export interface RingInput {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate?: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
}

/** 复核登记（重捕 / 回收）输入：只记录本次现场事件，不携带原档案字段 */
export interface RecheckInput {
  ringNo: string;
  /** 现场复核到的彩环组合（默认带出原档案，可按现场修正） */
  colorRing: string;
  status: Exclude<RingStatus, '初捕'>;
  ringDate?: string;
  netNo: string;
  netRound: number;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
}

/** 复核登记结果：鸟种不吻合时返回 mismatch 并停下，原档案不会被改动 */
export type RecheckResult =
  | { outcome: 'added'; record: RingRecord }
  | { outcome: 'missing' }
  | { outcome: 'mismatch'; original: RingRecord; observedSpeciesCn: string; observedSpeciesSci: string };

/** 同一环号多事件的时间顺序：先按日期，同日初捕在最前，再以录入先后兜底 */
function compareChronology(a: RingRecord, b: RingRecord): number {
  const byDate = a.ringDate.localeCompare(b.ringDate);
  if (byDate !== 0) return byDate;
  const rank = (status: RingStatus) => (status === '初捕' ? 0 : status === '重捕' ? 1 : 2);
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.id.localeCompare(b.id);
}

interface RingState {
  rings: RingRecord[];
  /** 环号重复时命中的历史记录 id */
  duplicateId: string;
  hydrated: boolean;
}

/** 环志记录与查重结果 */
export const useRingStore = defineStore('ring', {
  state: (): RingState => ({ rings: [], duplicateId: '', hydrated: false }),

  getters: {
    findByRingNo(state) {
      return (ringNo: string): RingRecord | undefined =>
        state.rings.find((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase());
    },
    /** 同一环号的全部历史记录（含重捕 / 回收），按时间串成一只鸟的经历 */
    historyOf(state) {
      return (ringNo: string): RingRecord[] =>
        state.rings
          .filter((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
          .sort(compareChronology);
    },
    duplicate(state): RingRecord | undefined {
      return state.rings.find((record) => record.id === state.duplicateId);
    },
  },

  actions: {
    async hydrate() {
      this.rings = await db.rings.orderBy('ringDate').reverse().toArray();
      this.hydrated = true;
    },

    setDuplicate(id: string) {
      this.duplicateId = id;
    },

    /** 新增初捕记录：环号已存在时返回命中的历史记录，由页面引导改走复核登记 */
    async addRing(input: RingInput): Promise<{ record?: RingRecord; duplicate?: RingRecord }> {
      const existed = this.findByRingNo(input.ringNo);
      if (existed) {
        this.duplicateId = existed.id;
        return { duplicate: existed };
      }
      const record = await this.persist({
        ringNo: input.ringNo.trim(),
        colorRing: input.colorRing || '无',
        speciesCn: input.speciesCn.trim(),
        speciesSci: input.speciesSci.trim(),
        age: input.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      });
      this.duplicateId = '';
      return { record };
    },

    /**
     * 复核登记（重捕 / 回收）：输入旧环号与现场鸟种，命中且鸟种吻合才追加一条新事件，
     * 鸟种不吻合或查无此环时直接返回，原档案保持不变（不会被覆盖）。
     */
    async recheckRing(
      input: RecheckInput,
      observed: { speciesCn: string; speciesSci: string },
    ): Promise<RecheckResult> {
      const history = this.historyOf(input.ringNo);
      const original = history[0];
      if (!original) {
        return { outcome: 'missing' };
      }
      const observedCn = observed.speciesCn.trim();
      if (observedCn.toLowerCase() !== original.speciesCn.trim().toLowerCase()) {
        return { outcome: 'mismatch', original, observedSpeciesCn: observedCn, observedSpeciesSci: observed.speciesSci.trim() };
      }
      // 鸟种、年龄沿用原档案；彩环与本次现场信息单独成条，历史记录一条都不改
      const record = await this.persist({
        ringNo: original.ringNo,
        colorRing: input.colorRing?.trim() || original.colorRing || '无',
        speciesCn: original.speciesCn,
        speciesSci: original.speciesSci,
        age: original.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      });
      this.duplicateId = '';
      return { outcome: 'added', record };
    },

    /** 落库一条全新事件记录（追加，不影响任何历史条目） */
    async persist(record: Omit<RingRecord, 'id'> & { id?: string }): Promise<RingRecord> {
      const next: RingRecord = { ...record, id: record.id || uid('ring') };
      await db.rings.put(toPlain(next));
      this.rings = [next, ...this.rings];
      return next;
    },

    async updateRing(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      const next: RingRecord = { ...current, ...patch };
      await db.rings.put(toPlain(next));
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    async removeRing(id: string) {
      await db.rings.delete(id);
      this.rings = this.rings.filter((record) => record.id !== id);
    },
  },
});
