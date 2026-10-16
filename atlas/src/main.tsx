import { render } from 'preact';
// variable fonts: one file per family/style instead of one per weight
import '@fontsource-variable/eb-garamond/wght.css';
import '@fontsource-variable/eb-garamond/wght-italic.css';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/caveat/500.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/reader.css';
import './styles/views2.css';
import './styles/genres.css';
import './styles/game.css';
import { App } from './app.tsx';

render(<App />, document.getElementById('app')!);
