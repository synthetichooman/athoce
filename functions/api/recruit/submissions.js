import { submissionKeys, readSubmissions } from '../../_recruit-store.js';
import { isAdminAuthorized } from '../../_config.js';
import { InterliningError, adminJson, errorResponse } from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return adminJson({ ok: false, error: { code: 'UNAUTHORIZED', message: '관리자 로그인이 필요합니다.' } }, 401);
  }
  try {
    const query = new URL(request.url).searchParams;
    const page = Number(query.get('page') || 1);
    const limit = Number(query.get('limit') || 50);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) {
      throw new InterliningError('INVALID_QUERY', '페이지와 조회 개수를 확인해 주세요.', 400);
    }
    const keys = await submissionKeys(env);
    const offset = (page - 1) * limit;
    const list = await readSubmissions(env, keys.slice(offset, offset + limit));
    return adminJson({ ok: true, data: {
      page, limit, totalCount: keys.length, totalPage: Math.ceil(keys.length / limit), list,
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
