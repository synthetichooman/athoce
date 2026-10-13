import { submissionKeys, readSubmissions } from '../../_interlining-store.js';
import { interliningAccess } from '../../_interlining-access.js';
import {
  INTERLINING_FORM, INTERLINING_UNIT, InterliningError, adminJson,
  communityData, errorResponse, normalizeSubmission, resolveInterliningForm,
} from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  if (!(await interliningAccess(request, env))) {
    return adminJson({ ok: false, error: { code: 'UNAUTHORIZED', message: '관리자 로그인이 필요합니다.' } }, 401);
  }
  try {
    const query = new URL(request.url).searchParams;
    const page = Number(query.get('page') || 1);
    const limit = Number(query.get('limit') || 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InterliningError('INVALID_QUERY', '페이지와 조회 개수를 확인해 주세요.', 400);
    }
    const keys = await submissionKeys(env);
    const offset = (page - 1) * limit;
    const local = await readSubmissions(env, keys.slice(offset, offset + limit));
    let remote;
    const cached = new Map();
    try {
      const formNo = await resolveInterliningForm(env);
      const remotePage = async (number) => {
        if (cached.has(number)) return cached.get(number);
        const data = await communityData(env, 'form-submissions', { page: number, limit, unitCode: INTERLINING_UNIT, formNo });
        if (data.list.some((item) => item.unitCode !== INTERLINING_UNIT || item.formCode !== INTERLINING_FORM || Number(item.formNo) !== formNo)) {
          throw new InterliningError('FORM_MISMATCH', 'interlining 신청 내역인지 확인하지 못했습니다.');
        }
        if (!Number.isInteger(Number(data.totalCount)) || Number(data.totalCount) < 0 || !Number.isInteger(Number(data.totalPage)) || Number(data.totalPage) < 0 ||
            Number(data.currentPage) !== number || data.list.some((item) => !item.submitCode)) {
          throw new InterliningError('IMWEB_RESPONSE_CHANGED', '신청 목록 응답을 확인하지 못했습니다.');
        }
        cached.set(number, data);
        return data;
      };
      const first = await remotePage(1);
      remote = { totalCount: Number(first.totalCount), rows: [] };
      const remoteOffset = Math.max(0, offset - keys.length);
      const count = Math.min(limit - local.length, Math.max(0, remote.totalCount - remoteOffset));
      if (count > 0) {
        const firstPage = Math.floor(remoteOffset / limit) + 1;
        const lastPage = Math.floor((remoteOffset + count - 1) / limit) + 1;
        const rows = [];
        for (let number = firstPage; number <= lastPage; number++) {
          const part = await remotePage(number);
          if (Number(part.totalCount) !== remote.totalCount) throw new InterliningError('LIST_CHANGED', '조회 중 신청 목록이 변경되었습니다. 다시 조회해 주세요.');
          rows.push(...part.list);
        }
        remote.rows = rows.slice(remoteOffset % limit, remoteOffset % limit + count).map(normalizeSubmission);
        if (remote.rows.length !== count) throw new InterliningError('IMWEB_RESPONSE_CHANGED', '신청 목록 응답을 확인하지 못했습니다.');
      }
    } catch (error) {
      if (!keys.length) throw error;
      return adminJson({ ok: true, data: {
        page, limit, totalCount: keys.length, totalPage: Math.ceil(keys.length / limit), list: local, incomplete: true,
        warning: 'ATHOCE 신청 목록입니다. 기존 아임웹 신청은 현재 조회할 수 없습니다. 연결을 확인한 뒤 전체 내역을 내려받아 주세요.',
      } });
    }
    const totalCount = keys.length + remote.totalCount;
    return adminJson({ ok: true, data: {
      page, limit, totalCount, totalPage: Math.ceil(totalCount / limit), list: [...local, ...remote.rows],
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
