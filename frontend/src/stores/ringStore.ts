import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { BirdAge, RingRecord, RingStatus, ReviewStatus } from '../types/ring-record';

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

/** 复核登记（重捕 / 回收）入参：鸟种、彩环、年龄均沿用原档案，不在此覆盖 */
export interface ReviewEventInput {
  ringNo: string;
  /** 现场辨认鸟种，必须与原档案一致才允许落库 */
  observedSpecies: string;
  ringDate?: string;
  netNo: string;
  status: ReviewStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
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
    /** 同一环号的全部历史记录（含重捕 / 回收），按时间正序 */
    historyOf(state) {
      return (ringNo: string): RingRecord[] =>
        state.rings
          .filter((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate) || a.id.localeCompare(b.id));
    },
    /** 原档案：同一环号最早的一次记录（通常为初捕），复核时带出鸟种与彩环 */
    originOf(state) {
      return (ringNo: string): RingRecord | undefined => {
        const list = state.rings
          .filter((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate) || a.id.localeCompare(b.id));
        return list[0];
      };
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

    /** 新增环志记录：环号已存在时返回命中的历史记录，由页面提示并跳转 */
    async addRing(input: RingInput): Promise<{ record?: RingRecord; duplicate?: RingRecord }> {
      const existed = this.findByRingNo(input.ringNo);
      if (existed) {
        this.duplicateId = existed.id;
        return { duplicate: existed };
      }
      const record: RingRecord = {
        id: uid('ring'),
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
      };
      await db.rings.put(toPlain(record));
      this.rings = [record, ...this.rings];
      this.duplicateId = '';
      return { record };
    },

    /**
     * 复核登记：为已建档的环号新增一条重捕 / 回收事件。
     * 不覆盖原档案——新记录另发 id，鸟种、学名、彩环、年龄全部沿用原档案。
     * 现场鸟种与原档案不一致时拒绝落库，返回原因，由页面提示并停下。
     */
    async addReviewEvent(
      input: ReviewEventInput,
    ): Promise<{ record?: RingRecord; origin?: RingRecord; reason?: string }> {
      const origin = this.originOf(input.ringNo);
      if (!origin) {
        return { reason: `环号 ${input.ringNo.trim()} 查无原档案，请先在「登记环志记录」中初捕建档` };
      }
      const observed = input.observedSpecies.trim();
      if (observed !== origin.speciesCn) {
        return {
          origin,
          reason: `现场鸟种「${observed}」与原档案「${origin.speciesCn}」不一致，已停止登记且未改动原档案，请核对环号 / 鸟种后再复核`,
        };
      }
      const record: RingRecord = {
        id: uid('ring'),
        ringNo: origin.ringNo,
        colorRing: origin.colorRing,
        speciesCn: origin.speciesCn,
        speciesSci: origin.speciesSci,
        age: origin.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      };
      await db.rings.put(toPlain(record));
      this.rings = [record, ...this.rings];
      return { record, origin };
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
