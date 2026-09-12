import { render } from 'solid-js/web';
import './styles/base.css';
import '@peri/ui/styles.css';
import './styles/extra.css';
import './styles/sandbox-shell.css';
import './styles/git-graph.css';
import './styles/project-sidebar.css';
import { App } from './App';
import { bootstrapTokenOverrides } from '@/lib/token-editor';
import { bootstrapPaletteScales } from '@/lib/palette-scale';
import { setupMarkdownRuntime } from '@/lib/markdown-setup';

bootstrapPaletteScales();
bootstrapTokenOverrides();
setupMarkdownRuntime();

render(() => <App />, document.getElementById('root')!);
