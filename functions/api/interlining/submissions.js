import { isAdminAuthorized } from '../../_config.js';
import {
  INTERLINING_FORM, INTERLINING_UNIT, InterliningError, adminJson,
  communityData, errorResponse, normalizeSubmission, resolveInterliningForm,
} from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return adminJson({ ok: false, error: { code: 'UNAUTHORIZED', message: '관리자 로그인이 필요합니다.' } }, 401);
  }
  try {
    const query = new URL(request.url).searchParams;
    const page = Number(query.get('page') || 1);
    const limit = Number(query.get('limit') || 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InterliningError('INVALID_QUERY', '페이지와 조회 개수를 확인해 주세요.', 400);
    }
    const formNo = await resolveInterliningForm(env);
    const data = await communityData(env, 'form-submissions', { page, limit, unitCode: INTERLINING_UNIT, formNo });
    if (data.list.some((item) => item.unitCode !== INTERLINING_UNIT || item.formCode !== INTERLINING_FORM || Number(item.formNo) !== formNo)) {
      throw new InterliningError('FORM_MISMATCH', 'interlining 신청 내역인지 확인하지 못했습니다.');
    }
    const totalCount = Number(data.totalCount);
    const totalPage = Number(data.totalPage);
    if (!Number.isInteger(totalCount) || totalCount < 0 || !Number.isInteger(totalPage) || totalPage < 0 ||
        Number(data.currentPage) !== page || data.list.some((item) => !item.submitCode)) {
      throw new InterliningError('IMWEB_RESPONSE_CHANGED', '신청 목록 응답을 확인하지 못했습니다.');
    }
    return adminJson({ ok: true, data: {
      page, limit, totalCount, totalPage, list: data.list.map(normalizeSubmission),
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
