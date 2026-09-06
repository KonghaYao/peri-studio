// peri-studio Web 外壳入口（`/`，唯一页面）。

import { render } from 'solid-js/web';
import '@xterm/xterm/css/xterm.css';
import '../styles.css';
import { PanelPage } from '@/pages/panel';

render(() => <PanelPage />, document.getElementById('app')!);
