// peri-studio Web 外壳入口（`/`，唯一页面）。

import { render } from 'solid-js/web';
import '../styles.css';
import { setupMarkdownRuntime } from '@/lib/markdown-setup';
import { PanelPage } from '@/pages/panel';

setupMarkdownRuntime();
render(() => <PanelPage />, document.getElementById('app')!);
