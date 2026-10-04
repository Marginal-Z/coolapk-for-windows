import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCreation } from '../core/creation.mjs';
import { normalizeQuestionTitle, preparePoll } from '../core/creation-models.mjs';
import { findDexMaps, inspectApkContracts, readApkDex } from '../scripts/inspect-apk-contracts.mjs';

function mock(identity = { uid: '42' }) {
  const calls = [], pictures = [];
  return { calls, pictures, client: { identity, validatePictures: async value => { pictures.push(value); return value; }, request: async (path, query, options) => { calls.push({ path, query, options }); return { data: { id: '601' } }; } } };
}
const poll = { title: '模拟投票', options: ['甲', '乙'], pollType: 1, endTime: 604800, maxSelectNum: 1 };

test('question titles follow the mobile UTF16 limit including the automatic question mark', () => {
  assert.equal(normalizeQuestionTitle('  电脑能否外接显卡  '), '电脑能否外接显卡？');
  assert.equal(normalizeQuestionTitle('请问？'), '请问？'); assert.equal(normalizeQuestionTitle('Question?'), 'Question?');
  assert.equal(normalizeQuestionTitle('🙂'.repeat(29) + '？').length, 59);
  assert.throws(() => normalizeQuestionTitle('🙂'.repeat(30)), /精简/);
  for (const title of ['', '   ', '坏\n标题', '坏\r标题', '坏\0标题', 9]) assert.throws(() => normalizeQuestionTitle(title));
});

test('question creation uses the recovered request model and authenticated image validation', async () => {
  const { client, calls, pictures } = mock();
  await dispatchCreation(client, 'questionCreate', { title: '模拟测试问题', message: '仅测试请求构造\n无真实发布', pic: 'https://image.coolapk.com/feed/synthetic.jpg', publishOptions: { targetType: 'tag', targetId: 'Windows', visibleStatus: -1, originalType: 1 } });
  assert.equal(calls.length, 1); assert.deepEqual(pictures, ['https://image.coolapk.com/feed/synthetic.jpg']);
  assert.equal(calls[0].path, '/v6/feed/createFeed'); assert.deepEqual(calls[0].query, {}); assert.equal(calls[0].options.method, 'POST');
  const form = calls[0].options.form;
  assert.equal(form.type, 'question'); assert.equal(form.message_title, '模拟测试问题？'); assert.equal(form.message, '仅测试请求构造\n无真实发布');
  assert.equal(form.publish_status, 1); assert.equal(form.targetType, 'tag'); assert.equal(form.targetId, 'Windows'); assert.equal(form.original_type, 1); assert.equal(form.is_html_article, 0);
});

test('option and PK poll requests preserve exact indexed fields, duration and restrictions', async () => {
  const { client, calls } = mock();
  await dispatchCreation(client, 'pollCreate', { ...poll, options: ['甲', '乙', '丙'], maxSelectNum: 2 });
  await dispatchCreation(client, 'pollCreate', { ...poll, pollType: 0, colors: ['#e57373', '#64b5f6'] });
  const form = calls[0].options.form;
  assert.equal(form.type, 'vote'); assert.equal(form.message_title, '模拟投票'); assert.equal(form.vote_type, 1); assert.equal(form.vote_min_select_num, 1); assert.equal(form.vote_max_select_num, 2); assert.equal(form.vote_end_time, 604800);
  assert.equal(form['vote_option[0]'], '甲'); assert.equal(form['vote_option[2]'], '丙'); assert.equal(form.vote_show_author, 1); assert.equal(form.vote_tag, ''); assert.equal(form.vote_page, ''); assert.equal(form.pic, '');
  assert.equal(calls[1].options.form.vote_type, 0); assert.equal(calls[1].options.form.vote_max_select_num, 1); assert.equal(calls[1].options.form['vote_option_color[0]'], '#E57373');
  assert.equal(Object.hasOwn(form, 'anonymous_status'), false); assert.equal(Object.hasOwn(form, 'vote_anonymous_status'), false);
});

test('ordinary users cannot forge admin-only poll options or arbitrary form fields', async () => {
  const invalid = [{ ...poll, options: ['甲'] }, { ...poll, options: Array(11).fill('甲') }, { ...poll, options: ['甲', ''] }, { ...poll, options: ['甲'.repeat(21), '乙'] }, { ...poll, pollType: 0, options: ['甲'.repeat(11), '乙'] }, { ...poll, pollType: 0, maxSelectNum: 2 }, { ...poll, endTime: 123 }, { ...poll, maxSelectNum: 0 }, { ...poll, maxSelectNum: 3 }, { ...poll, maxSelectNum: 1.2 }, { ...poll, pollType: 7 }, { ...poll, vote_page: '/privileged' }, { ...poll, colors: ['#123456', '#abcdef'] }, { ...poll, pollType: 0, colors: ['url(x)', '#abcdef'] }, { ...poll, publishOptions: { targetType: 'apk', targetId: 'com.example.test' } }, { ...poll, publishOptions: { htmlArticle: true } }];
  for (const args of invalid) { const { client, calls } = mock(); await assert.rejects(dispatchCreation(client, 'pollCreate', args), error => error.code === 'INPUT'); assert.equal(calls.length, 0); }
  for (const value of [86400, 604800, 2592000]) assert.equal(preparePoll({ ...poll, endTime: value }).endTime, value);
});

test('question and poll mutations require login before uploads or requests', async () => {
  for (const [op, args] of [['questionCreate', { title: '模拟问题', pic: 'https://image.coolapk.com/feed/synthetic.jpg' }], ['pollCreate', poll]]) {
    const { client, calls, pictures } = mock(null); await assert.rejects(dispatchCreation(client, op, args), error => error.code === 'LOGIN_REQUIRED'); assert.equal(calls.length, 0); assert.equal(pictures.length, 0);
  }
});

test('ambiguous network or missing results are not reported as success or automatically replayed', async () => {
  for (const failure of ['NETWORK', 'HTTP', 'missing', 'invalidId', 'zeroId']) {
    const { client, calls } = mock(); client.request = async () => { calls.push({}); if (failure === 'missing') return { data: {} }; if (failure === 'invalidId') return { data: { id: '../1' } }; if (failure === 'zeroId') return { data: { id: '0' } }; const error = new Error('synthetic failure'); error.code = failure; throw error; };
    await assert.rejects(dispatchCreation(client, 'pollCreate', poll), error => error.code === 'WRITE_UNCONFIRMED'); assert.equal(calls.length, 1);
  }
  const { client } = mock(); const challenge = Object.assign(new Error('synthetic verification'), { code: 'VERIFY_REQUIRED' }); client.request = async () => { throw challenge; };
  await assert.rejects(dispatchCreation(client, 'questionCreate', { title: '模拟问题' }), error => error === challenge);
});

test('related question read uses only its exact title binding and validates list structure', async () => {
  const { client, calls } = mock(null); client.request = async (path, query) => { calls.push({ path, query }); return { data: [{ id: '100', messageTitle: '模拟相关问题？' }] }; };
  const result = await dispatchCreation(client, 'relatedQuestions', { title: '模拟相关问题' }); assert.equal(result.data[0].id, '100'); assert.deepEqual(calls[0], { path: '/v6/feed/relatedQuestion', query: { title: '模拟相关问题？' } });
  await assert.rejects(dispatchCreation(client, 'relatedQuestions', { title: '问题', endpoint: '/v6/feed/deleteFeed' })); assert.equal(calls.length, 1);
  client.request = async () => ({ data: {} }); await assert.rejects(dispatchCreation(client, 'relatedQuestions', { title: '问题' }), error => error.code === 'API_ERROR');
  assert.equal(await dispatchCreation(client, 'unknown'), undefined);
});

test('static APK discovery rejects malformed inputs and arbitrary filters without executing content', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(112), Buffer.from('not-an-apk')]) assert.throws(() => readApkDex(bytes));
  assert.deepEqual(findDexMaps(Buffer.alloc(256)), []);
  assert.throws(() => inspectApkContracts(Buffer.alloc(100), '.*'), /filter/);
  assert.throws(() => inspectApkContracts(Buffer.alloc(100), 'a'.repeat(101)), /filter/);
});
