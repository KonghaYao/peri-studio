import { render } from 'solid-js/web';
import './styles/theme.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/sandbox-shell.css';
import './styles/git-graph.css';
import { App } from './App';

render(() => <App />, document.getElementById('root')!);
