import { render } from 'solid-js/web';
import './styles/theme.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/extra.css';
import './styles/sandbox-shell.css';
import './styles/git-graph.css';
import './styles/project-sidebar.css';
import { App } from './App';

render(() => <App />, document.getElementById('root')!);
