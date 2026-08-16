/**
 * 端到端演示：使用官方 @modelcontextprotocol/client 的 Client，
 * 在进程内通过 InMemoryTransport（不经过 stdio/网络）驱动上面的
 * office MCP server，完整验证 @peri/mcpp 的 skill 挂载链路：
 *
 *   1. resources/list / templates/list —— skills/ 目录自动发现的 skill
 *   2. resources/read skill://{name}/SKILL.md —— SKILL.md 全文（frontmatter 校验）
 *   3. tools/list —— 工具目录（anydoc / notify_skill_changed）
 *   4. 订阅 skill 资源 + notify 触发器 —— 收到 resources/updated 通知
 *   5. 退订后不再收到
 *
 * 运行：bun demo-client.ts
 */
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createOfficeServer } from '../src/index.ts';

const tick = (msg: string) => console.log(`\n▶ ${msg}`);
const pretty = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  // server 与 client 各持一对相连的 InMemoryTransport 的一端
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await createOfficeServer().connect(serverTransport);

  // 官方 Client：connect() 会自动完成 initialize / initialized 握手。
  const client = new Client({ name: 'demo-client', version: '0.1.0' });
  await client.connect(clientTransport);

  // ---------------------------------------------------------------------------
  // 1. Resource —— skills/ 目录自动挂载（MCPP 3.4 通道 B 的投影）
  // ---------------------------------------------------------------------------
  tick('resources/templates/list（skill://{skillName}/SKILL.md 模板）');
  pretty(await client.listResourceTemplates());

  tick('resources/list 中自动发现的 skills（模板 list 回调实时枚举）');
  const all = await client.listResources();
  pretty(all.resources?.filter((r) => r.uri.startsWith('skill://')));

  // ---------------------------------------------------------------------------
  // 2. Resource —— 读取单个 SKILL.md 全文
  // ---------------------------------------------------------------------------
  tick('resources/read skill://convert-documents-to-markdown/SKILL.md');
  const read = await client.readResource({
    uri: 'skill://convert-documents-to-markdown/SKILL.md',
  });
  const block = read.contents[0];
  console.log(
    block === undefined
      ? '<empty contents>'
      : 'blob' in block
        ? `<blob ${block.mimeType ?? ''} bytes=${block.blob.length}>`
        : block.text.slice(0, 180) + '\n…（截断）',
  );

  // 未命中（不存在/非法名）→ 资源不存在错误
  tick('resources/read skill://no-such-skill/SKILL.md（未命中 → ResourceNotFound）');
  try {
    await client.readResource({ uri: 'skill://no-such-skill/SKILL.md' });
    console.log('unexpected: 应当抛错');
  } catch (error) {
    console.log(error instanceof Error ? error.message : error);
  }

  // ---------------------------------------------------------------------------
  // 3. Tool —— 工具目录（懒加载入口；定义按命中拉取）
  // ---------------------------------------------------------------------------
  tick('tools/list');
  const tools = await client.listTools();
  pretty(tools.tools?.map((t) => ({ name: t.name, title: t.title })));

  // ---------------------------------------------------------------------------
  // 4. Subscription —— 订阅 skill 资源，通知触发器推送 resources/updated
  // ---------------------------------------------------------------------------
  const SKILL_URI = 'skill://convert-documents-to-markdown/SKILL.md';
  let updatedUri = '';
  client.setNotificationHandler(
    'notifications/resources/updated',
    (notification) => {
      updatedUri = notification.params.uri;
      console.log(`  ⇦ received notifications/resources/updated → ${notification.params.uri}`);
    },
  );

  tick(`resources/subscribe ${SKILL_URI}`);
  await client.subscribeResource({ uri: SKILL_URI });
  console.log('subscribed ✔');

  tick('tools/call notify_skill_changed → client 应收到 resources/updated 通知');
  await client.callTool({
    name: 'notify_skill_changed',
    arguments: { skillName: 'convert-documents-to-markdown' },
  });
  await sleep(300);
  console.log(
    updatedUri === SKILL_URI
      ? '订阅通知已送达 ✔（无需轮询即可感知 skill 内容变更）'
      : '未收到订阅通知 ✘',
  );

  // ---------------------------------------------------------------------------
  // 5. Subscription —— 退订后，通知不应再送达
  // ---------------------------------------------------------------------------
  tick(`resources/unsubscribe ${SKILL_URI}，再次触发通知`);
  await client.unsubscribeResource({ uri: SKILL_URI });
  await sleep(500); // 等待退订在服务端落定（listen 流关闭为异步确认）
  updatedUri = '';
  await client.callTool({
    name: 'notify_skill_changed',
    arguments: { skillName: 'convert-documents-to-markdown' },
  });
  await sleep(500);
  console.log(updatedUri === '' ? '退订后未再收到通知 ✔' : '退订后仍收到通知 ✘（SDK 流关闭语义）');

  await client.close();
  await serverTransport.close();
  console.log('\n✅ demo finished');
  process.exit(0); // 显式退出：InMemory 订阅流可能残留协议级 handle
}

main().catch((error) => {
  console.error('demo failed:', error);
  process.exit(1);
});